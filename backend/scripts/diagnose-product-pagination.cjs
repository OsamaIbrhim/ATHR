#!/usr/bin/env node
// WP-P1 Phase A -- read-only diagnostic. Answers one question with evidence
// instead of assumption: on `GET /products?page=500&page_size=20`, is the
// `OFFSET 10000` what dominates the time?
//
// The WP is explicit that if OFFSET is not the dominant cost, the diagnosis is
// wrong and everything built on it is built on sand. So this script does not
// hand-write an approximation of the query -- it constructs the compiled
// `ProductsRepository` against a real PrismaClient, calls `listVariants` /
// `countVariants` exactly as `ProductsService.list` does, captures the SQL
// Prisma actually emitted via the query event stream, and runs
// `EXPLAIN (ANALYZE, BUFFERS)` on that captured statement. (The lesson from
// WP-P0: a proof that reimplements the shape proves nothing about the shipped
// code.)
//
// It also closes the measurement gap in `perf/hard-load.mjs`: that harness
// measures `/products?page=1` at concurrency 1 but never `page=500`, so the
// only page=500 numbers on record are from a 25-way saturated run where p95 is
// dominated by queueing. Without a concurrency-1 sample there is no way to
// tell a per-request cost problem from a throughput/saturation artifact. The
// HTTP probe below supplies it.
//
// Read-only: no INSERT/UPDATE/DELETE, no DDL, no migration. Safe to run
// against the perf database after the load suite (and it is deliberately run
// *after*, so it cannot warm caches for the measurement it is explaining).
'use strict';

const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const PAGES = [1, 100, 500];
const PAGE_SIZE = 20;
const HTTP_SAMPLES = 10;

const distRepository = path.join(
  __dirname,
  '..',
  'dist',
  'src',
  'products',
  'products.repository.js',
);

let ProductsRepository;
try {
  ({ ProductsRepository } = require(distRepository));
} catch (error) {
  console.error(
    `Could not load the compiled ProductsRepository from ${distRepository}. This script ` +
      `explains the shipped query, not a copy of it, so it requires \`npm run build\` first. ` +
      `Original error: ${error?.message ?? error}`,
  );
  process.exit(1);
}

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });

/** Captures every statement Prisma emits so the next one can be EXPLAINed. */
const emitted = [];
prisma.$on('query', (event) => {
  emitted.push({ query: event.query, params: event.params, duration: event.duration });
});

function section(title) {
  process.stdout.write(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n`);
}

/**
 * Prisma logs parameters as a JSON array, and re-binding them through
 * `$queryRawUnsafe` loses their Postgres types (a uuid column compared against
 * a JS string errors as `uuid = text`). Inlining them as untyped literals lets
 * Postgres coerce them the same way it does for the real prepared statement.
 * Every value here originates from this script or from Prisma's own log, never
 * from a request, and anything that is not a number/boolean/plain string is
 * rejected rather than escaped-and-hoped.
 */
function inlineParams(sql, rawParams) {
  let params;
  try {
    params = JSON.parse(rawParams);
  } catch {
    throw new Error(`Could not parse Prisma params: ${rawParams}`);
  }
  if (!Array.isArray(params)) throw new Error(`Prisma params were not an array: ${rawParams}`);

  return sql.replace(/\$(\d+)/g, (_match, index) => {
    const value = params[Number(index) - 1];
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Non-finite numeric parameter: ${value}`);
      return String(value);
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    throw new Error(`Unsupported parameter type ${typeof value} in ${rawParams}`);
  });
}

async function explain(label, sql, rawParams) {
  const statement = inlineParams(sql, rawParams);
  process.stdout.write(`\n--- ${label} ---\nSQL: ${statement}\n\n`);
  const plan = await prisma.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING) ${statement}`,
  );
  for (const row of plan) process.stdout.write(`${row['QUERY PLAN']}\n`);
}

/** The tenant the perf seed loaded, i.e. the one the hard-load suite reads. */
async function busiestTenant() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "tenant_id"::text AS tenant_id, COUNT(*)::int AS variants
       FROM "ProductVariant"
      WHERE "is_active" = TRUE
      GROUP BY "tenant_id"
      ORDER BY variants DESC
      LIMIT 1`,
  );
  if (!rows.length) throw new Error('No active ProductVariant rows -- was `npm run perf:seed` run?');
  return rows[0];
}

async function reportIndexes() {
  section('Existing indexes on the tables this query touches');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT tablename, indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename IN ('ProductVariant', 'Product')
      ORDER BY tablename, indexname`,
  );
  for (const row of rows) process.stdout.write(`${row.tablename}: ${row.indexdef}\n`);
}

async function reportServerSettings() {
  section('Postgres server context');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT version() AS version,
            current_setting('work_mem') AS work_mem,
            current_setting('shared_buffers') AS shared_buffers,
            current_setting('effective_cache_size') AS effective_cache_size,
            current_setting('max_connections') AS max_connections`,
  );
  process.stdout.write(`${JSON.stringify(rows[0], null, 2)}\n`);
  const stats = await prisma.$queryRawUnsafe(
    `SELECT relname,
            n_live_tup::int AS live_rows,
            last_analyze,
            last_autoanalyze
       FROM pg_stat_user_tables
      WHERE relname IN ('ProductVariant', 'Product')
      ORDER BY relname`,
  );
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
}

/**
 * The plan evidence. For each page: run the real repository call, take the SQL
 * Prisma emitted for it, and EXPLAIN that. `duration` from the query event is
 * the driver-observed time for the same statement, reported alongside so the
 * plan and the clock can be compared.
 */
async function explainRepositoryQueries(tenantId) {
  const repository = new ProductsRepository(prisma);
  const context = { tenantId };
  const where = repository.variantWhere(context, '');

  section('Plans for the shipped ProductsRepository queries');
  process.stdout.write(
    `Tenant ${tenantId}; ORDER BY as shipped: [{ created_at: 'desc' }, { id: 'asc' }]\n`,
  );

  for (const page of PAGES) {
    emitted.length = 0;
    const started = process.hrtime.bigint();
    const rows = await repository.listVariants(context, where, page, PAGE_SIZE);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const statement = emitted.find((entry) => /SELECT/i.test(entry.query) && /OFFSET|LIMIT/i.test(entry.query));
    process.stdout.write(
      `\n### page=${page} (OFFSET ${(page - 1) * PAGE_SIZE}) -- returned ${rows.length} rows, ` +
        `repository call ${elapsedMs.toFixed(1)}ms, driver-reported statement time ` +
        `${statement ? statement.duration : 'n/a'}ms\n`,
    );
    if (!statement) {
      process.stdout.write(
        `No paginated SELECT captured. Statements seen: ${emitted.map((e) => e.query).join(' | ')}\n`,
      );
      continue;
    }
    await explain(`listVariants page=${page}`, statement.query, statement.params);
  }

  // The count runs on every list request too (5s cache, so it is not paid by
  // every request under load, but it is paid) -- reported so the read's total
  // cost is not attributed to the offset walk alone.
  emitted.length = 0;
  const total = await repository.countVariants(context, where);
  const countStatement = emitted.find((entry) => /COUNT/i.test(entry.query));
  process.stdout.write(`\n### countVariants -- total ${total}\n`);
  if (countStatement) {
    await explain('countVariants', countStatement.query, countStatement.params);
  }
}

/**
 * The discriminator the hard-load harness never measures: page=500 at
 * concurrency 1. If it comes back at page=1's few milliseconds, the p95 breach
 * is queueing under saturation and not per-request offset cost.
 */
async function httpProbe() {
  const api = process.env.PERF_API_URL || 'http://localhost:3000/api/v1';
  const phone = process.env.PERF_LOGIN_PHONE;
  const password = process.env.PERF_LOGIN_PASSWORD;
  if (!phone || !password) {
    process.stdout.write('\nSkipping HTTP probe: PERF_LOGIN_PHONE/PERF_LOGIN_PASSWORD are unset.\n');
    return;
  }

  section(`Sequential HTTP probe (concurrency 1, ${HTTP_SAMPLES} samples per page)`);
  let token;
  try {
    const login = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!login.ok) throw new Error(`HTTP ${login.status}`);
    ({ access_token: token } = await login.json());
  } catch (error) {
    process.stdout.write(`Skipping HTTP probe: login failed (${error?.message ?? error}).\n`);
    return;
  }

  for (const page of PAGES) {
    const path = `/products?page=${page}&page_size=${PAGE_SIZE}`;
    const client = [];
    const server = [];
    for (let index = 0; index < HTTP_SAMPLES; index += 1) {
      const started = performance.now();
      const response = await fetch(`${api}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      await response.arrayBuffer();
      client.push(performance.now() - started);
      const match = /(?:^|,)\s*app;dur=([0-9.]+)/i.exec(response.headers.get('server-timing') || '');
      if (match) server.push(Number(match[1]));
    }
    const median = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    process.stdout.write(
      `${JSON.stringify({
        type: 'sequential_probe',
        path,
        samples: client.length,
        client_median_ms: Math.round(median(client)),
        client_min_ms: Math.round(Math.min(...client)),
        client_max_ms: Math.round(Math.max(...client)),
        server_median_ms: server.length ? Math.round(median(server)) : null,
      })}\n`,
    );
  }
}

async function main() {
  const tenant = await busiestTenant();
  process.stdout.write(
    `WP-P1 Phase A diagnostic -- tenant ${tenant.tenant_id} with ${tenant.variants} active variants\n`,
  );
  await reportServerSettings();
  await reportIndexes();
  await explainRepositoryQueries(tenant.tenant_id);
  await httpProbe();
  process.stdout.write('\nDiagnostic complete (read-only; nothing was modified).\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
