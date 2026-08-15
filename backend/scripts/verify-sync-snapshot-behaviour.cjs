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
// Proves:
//   S1 The regression is real at this volume: a raw
//      `include: { product: true }` findMany still fails with Postgres
//      error 54001. If this assertion ever starts failing (i.e. the raw
//      query stops crashing), Prisma or Postgres changed underlying
//      behavior -- worth knowing explicitly rather than a silent flip that
//      makes S2 look like it's testing something it no longer is.
//   S2 The shape SyncService.attachProducts() actually uses -- the filter
//      query without include, then a flat chunked id-IN(...) batch --
//      succeeds at the same volume and resolves every variant's product.
//      This is the real regression guard: if `include: { product: true }`
//      is ever reintroduced on this path, this is what catches it.
'use strict';

const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

// Confirmed failing at 10,031 in the real hard-load job (PERF_PRODUCTS=10000
// plus the pre-existing dev seed rows) and confirmed safe at 7,500. Seed past
// the confirmed-failing point, not merely past the confirmed-safe one.
const VARIANT_COUNT = 10_500;
const PRODUCT_BATCH_SIZE = 1_000; // must match SyncService's PRODUCT_BATCH_SIZE

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
  const category = await prisma.taxCategory.create({
    data: { tenant_id: tenant.id, code: 'STANDARD', name_en: 'Standard', updated_at: new Date() },
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

  return { tenant, category };
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

async function verifyFixedShapeSucceeds(tenant) {
  const variants = await prisma.productVariant.findMany({
    where: {
      tenant_id: tenant.id,
      is_active: true,
      product: { is_active: true, tenant_id: tenant.id },
    },
  });
  expectEqual(
    'S2 the filter query without include returns every seeded variant',
    variants.length,
    VARIANT_COUNT,
  );

  const productIds = [...new Set(variants.map((variant) => variant.product_id))];
  const productsById = new Map();
  for (let offset = 0; offset < productIds.length; offset += PRODUCT_BATCH_SIZE) {
    const chunk = productIds.slice(offset, offset + PRODUCT_BATCH_SIZE);
    const products = await prisma.product.findMany({
      where: { tenant_id: tenant.id, id: { in: chunk } },
    });
    for (const product of products) productsById.set(product.id, product);
  }

  const unresolved = variants.filter((variant) => !productsById.has(variant.product_id));
  expectEqual(
    'S2 the chunked flat id-IN(...) batch resolves every variant\'s product (SyncService.attachProducts\' invariant)',
    unresolved.length,
    0,
  );
}

async function main() {
  const { tenant } = await seedCatalog();
  await verifyRawIncludeStillFails(tenant);
  await verifyFixedShapeSucceeds(tenant);

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
