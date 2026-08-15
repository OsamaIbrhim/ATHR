#!/usr/bin/env node
// fix/hard-load-stack-depth -- database-level proof for the POS catalog
// snapshot's query shape at realistic catalog volume. Wired into
// migration-gate, same convention as verify-tax-code-behaviour.cjs and
// verify-price-book-behaviour.cjs: a green fakePrisma spec proves nothing
// about real Postgres execution, and this is exactly that kind of bug.
//
// Root cause (the nightly `hard-load` job, CI runs 31859394076 and later):
// Prisma's automatic relation loader for `include: { product: true }` fans
// out into a Postgres statement that exceeds max_stack_depth once the
// parent ProductVariant result set is unbounded and large. Confirmed
// empirically against a real postgres:16 service container: safe at 100
// through 7,500 rows, fails with error 54001 ("stack depth limit exceeded")
// between 7,500 and 10,031 rows. `SyncService.snapshot()` and `pull()`'s
// resetCatalog branch used exactly that shape with no upper bound.
//
// SyncService.attachProducts() now replaces the Prisma `include` with the
// same filter query (no include) plus a manually chunked, flat
// `product.findMany({ where: { id: { in: chunk } } } })` -- a different,
// well-understood query shape, confirmed separately (via `psql` bisection)
// to be safe at the same volume with or without a JOIN.
//
// A prior version of this script proved the SHAPE works in isolation
// (a hand-copied reimplementation of the batching loop) but never called
// SyncService itself -- a revert of the actual fix, or a bad edit to
// PRODUCT_BATCH_SIZE, or a broken merge would have sailed through
// migration-gate. This version constructs SyncService directly against a
// real PrismaClient -- the pattern already used in
// `sync.cross-tenant.spec.ts` -- and asserts on the actual output of
// `.pull()` (which, with no cursor, calls the private `snapshot()`). It
// requires `npm run build` to have produced `dist/` first.
//
// Proves:
//   S1 The regression is real at this volume: a raw
//      `include: { product: true }` findMany still fails with Postgres
//      error 54001. If this assertion ever starts failing (i.e. the raw
//      query stops crashing), Prisma or Postgres changed underlying
//      behavior -- worth knowing explicitly rather than a silent flip that
//      makes S2 look like it's testing something it no longer is.
//   S2 SyncService.pull() -- the actual shipped code, not a reimplementation
//      of it -- succeeds at the same volume and returns every priced
//      variant. This is the real regression guard: if `include: { product:
//      true }` is ever reintroduced on this path, or PRODUCT_BATCH_SIZE is
//      changed to something unsafe, or the merge logic breaks, this fails.
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const distSync = path.join(__dirname, '..', 'dist', 'src', 'sync', 'sync.service.js');
const distPricing = path.join(__dirname, '..', 'dist', 'src', 'pricing', 'pricing.service.js');
const distTax = path.join(__dirname, '..', 'dist', 'src', 'tax', 'tax-resolution.service.js');

let SyncService, PRODUCT_BATCH_SIZE, PricingService, TaxResolutionService;
try {
  ({ SyncService, PRODUCT_BATCH_SIZE } = require(distSync));
  ({ PricingService } = require(distPricing));
  ({ TaxResolutionService } = require(distTax));
} catch (error) {
  console.error(
    `Could not load compiled SyncService from ${distSync}. This script asserts on the ` +
      `actual shipped code, so it requires \`npm run build\` to have run first (see ` +
      `migration-gate in ci.yml). Original error: ${error?.message ?? error}`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();

// Confirmed failing at 10,031 in the real hard-load job (PERF_PRODUCTS=10000
// plus the pre-existing dev seed rows) and confirmed safe at 7,500. Seed past
// the confirmed-failing point, not merely past the confirmed-safe one.
const VARIANT_COUNT = 10_500;

let failed = 0;

function record(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`);
}

function expectEqual(name, actual, expected) {
  const ok = actual === expected;
  record(name, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function seedCatalog() {
  const tenant = await prisma.tenant.create({
    data: { name: `sync-snapshot-verify-${randomUUID()}`, default_currency: 'EGP' },
  });
  const branch = await prisma.branch.create({
    data: { tenant_id: tenant.id, code: `SNAP-${randomUUID().slice(0, 8)}`, name_ar: 'فرع الفحص' },
  });
  const category = await prisma.taxCategory.create({
    data: { tenant_id: tenant.id, code: 'STANDARD', name_en: 'Standard', updated_at: new Date() },
  });
  // A minimal fully-priced catalog: one active TaxCode for the category and
  // one global, active, default PriceBookEntry, so every seeded variant
  // resolves a price and S2's count assertion is not confounded by
  // pricing/tax gaps unrelated to this bug (BR-PSL-101/BR-TAX-201 would
  // otherwise silently omit unpriced/untaxed variants from the result).
  await prisma.taxCode.create({
    data: {
      tenant_id: tenant.id,
      tax_category_id: category.id,
      code: 'STANDARD',
      name_en: 'Standard rate',
      jurisdiction: 'EG',
      calculation_method: 'percentage',
      rate: new Prisma.Decimal('14.0000'),
      tax_mode: 'exclusive',
      rounding_policy: 'line',
      version: 1,
      status: 'active',
      activated_at: new Date(),
      updated_at: new Date(),
    },
  });
  const priceBook = await prisma.priceBook.create({
    data: {
      tenant_id: tenant.id,
      name: 'Snapshot verify book',
      currency: 'EGP',
      status: 'active',
      is_default: true,
    },
  });
  await prisma.priceBookEntry.create({
    data: {
      tenant_id: tenant.id,
      price_book_id: priceBook.id,
      scope_type: 'global',
      scope_id: null,
      min_qty: 1,
      unit_price: 100,
      allow_zero_price: false,
      tax_mode: 'exclusive',
      effective_from: new Date(0),
      effective_to: null,
      status: 'active',
    },
  });

  const BATCH = 500;
  for (let offset = 0; offset < VARIANT_COUNT; offset += BATCH) {
    const size = Math.min(BATCH, VARIANT_COUNT - offset);
    const products = Array.from({ length: size }, (_, local) => {
      const index = offset + local;
      return {
        id: randomUUID(),
        tenant_id: tenant.id,
        name_en: `Snapshot verify product ${index}`,
        tax_category_id: category.id,
        is_active: true,
      };
    });
    await prisma.product.createMany({ data: products });
    await prisma.productVariant.createMany({
      data: products.map((product, local) => ({
        id: randomUUID(),
        tenant_id: tenant.id,
        product_id: product.id,
        sku: `SNAP-${offset + local}`,
        cost_price: 100,
        is_active: true,
      })),
    });
  }

  return { tenant, branch, category };
}

async function verifyRawIncludeStillFails(tenant) {
  try {
    await prisma.productVariant.findMany({
      where: {
        tenant_id: tenant.id,
        is_active: true,
        product: { is_active: true, tenant_id: tenant.id },
      },
      include: { product: true },
    });
    record(
      'S1 raw include:{product:true} still fails at 10,500 rows (documents the regression this works around)',
      false,
      'expected Postgres error 54001 but the query succeeded -- Prisma/Postgres behavior may have changed',
    );
  } catch (error) {
    const isStackDepth =
      error instanceof Prisma.PrismaClientUnknownRequestError &&
      String(error.message).includes('54001') &&
      String(error.message).includes('stack depth');
    record(
      'S1 raw include:{product:true} still fails at 10,500 rows (documents the regression this works around)',
      isStackDepth,
      isStackDepth ? undefined : `unexpected error: ${String(error?.message ?? error).slice(0, 300)}`,
    );
  }
}

async function verifyRealSyncServiceSucceeds(tenant, branch) {
  const tax = new TaxResolutionService(prisma);
  const pricing = new PricingService(prisma, tax);
  const service = new SyncService(prisma, pricing, tax);
  const context = { tenantId: tenant.id };

  let result;
  try {
    // No cursor -> pull() calls the private snapshot(), the code path that
    // crashed. This is SyncService.pull as shipped, not a reimplementation.
    result = await service.pull(context, branch.id);
  } catch (error) {
    record(
      'S2 SyncService.pull() (the real shipped code) succeeds at 10,500 rows',
      false,
      `threw: ${String(error?.message ?? error).slice(0, 300)}`,
    );
    return;
  }
  record('S2 SyncService.pull() (the real shipped code) succeeds at 10,500 rows', true);
  expectEqual(
    "S2 every seeded, fully-priced variant is present in the real snapshot's products",
    result.products.length,
    VARIANT_COUNT,
  );
}

async function main() {
  const { tenant, branch } = await seedCatalog();
  await verifyRawIncludeStillFails(tenant);
  await verifyRealSyncServiceSucceeds(tenant, branch);

  process.stdout.write(
    failed ? `\n${failed} check(s) FAILED\n` : '\nAll sync snapshot behaviour checks passed\n',
  );
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
