#!/usr/bin/env node
// WP-T2 / F4 -- database-level proof that the raw-SQL paths fakePrisma
// cannot honestly execute are actually tenant-scoped, not merely inspected.
// Same convention as verify-tax-code-behaviour.cjs / verify-promotion-
// behaviour.cjs / verify-sync-snapshot-behaviour.cjs: constructs the real
// compiled service classes against a real PrismaClient (this script asserts
// on the actual shipped code, not a reimplementation of its query shape --
// see verify-sync-snapshot-behaviour.cjs's header for why that distinction
// matters), so it requires `npm run build` to have run first.
//
// Scope (see docs/testing/test-fragility-analysis-2026-08-10.md item F4 and
// the WP-T2 PR description for the full 45-call-site inventory this is one
// part of): the three read-only multi-CTE raw-SQL statements that had only
// SQL-text assertions against fakePrisma (which proves a substring appears
// in the query text, never that it binds the calling tenant or reaches a
// real query planner) -- promoting them from that to an actual real-Postgres
// proof:
//   R1 PurchasingService.costReconciliation() -- purchasing.service.ts:1184
//   R2 TransfersService.reconcileInTransit()  -- transfers.service.ts:503
//   R3 InventoryRepository.reconciliationMismatches() -- inventory.repository.ts:73
//
// purchasing.service.ts:1000 (reverse()'s global-quantity aggregate, flagged
// in the WP-T2 report as structurally the WP-007 leak shape) does NOT need a
// proof here: InventoryStock.variant_id and TransferItem.variant_id both
// carry a COMPOSITE foreign key `(tenant_id, variant_id) -> ProductVariant
// (tenant_id, id)` (schema.prisma), which makes it schema-impossible for a
// row to reference a variant_id owned by a different tenant. That composite
// FK is already proven under real Postgres in CI by
// verify-tenant-constraints.cjs (cases 'InventoryStock.variant_id ->
// ProductVariant' and 'TransferItem.variant_id -> ProductVariant'). Filing a
// second proof of the same FK here would be redundant, not additional
// coverage.
//
// Every other raw-SQL call site this script does not cover (the 7
// stored-function calls, the locks with no tenant predicate flagged in the
// PR description, products.repository.ts:108, etc.) is named as a remaining
// gap in the PR description, not silently dropped.
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const distPurchasing = path.join(__dirname, '..', 'dist', 'src', 'purchasing', 'purchasing.service.js');
const distTransfers = path.join(__dirname, '..', 'dist', 'src', 'transfers', 'transfers.service.js');
const distInventoryRepo = path.join(__dirname, '..', 'dist', 'src', 'inventory', 'inventory.repository.js');

let PurchasingService, TransfersService, InventoryRepository;
try {
  ({ PurchasingService } = require(distPurchasing));
  ({ TransfersService } = require(distTransfers));
  ({ InventoryRepository } = require(distInventoryRepo));
} catch (error) {
  console.error(
    `Could not load compiled services from dist/. This script asserts on the ` +
      `actual shipped code, so it requires \`npm run build\` to have run first. ` +
      `Original error: ${error?.message ?? error}`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();

let failed = 0;

function record(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`);
}

function expectTrue(name, ok, detail) {
  record(name, ok === true, detail);
}

// --- fixture helpers ---------------------------------------------------------

async function createTenant(label) {
  return prisma.tenant.create({ data: { name: `${label}-${randomUUID()}`, default_currency: 'EGP' } });
}

async function createBranch(tenantId, label) {
  return prisma.branch.create({
    data: { tenant_id: tenantId, code: `${label}-${randomUUID().slice(0, 8)}`, name_ar: 'فرع الفحص' },
  });
}

async function createCategory(tenantId) {
  return prisma.taxCategory.create({
    data: { tenant_id: tenantId, code: 'STANDARD', name_en: 'Standard' },
  });
}

async function createVariant(tenantId, category, overrides = {}) {
  const product = await prisma.product.create({
    data: {
      tenant_id: tenantId,
      name_en: `Verify product ${randomUUID()}`,
      tax_category_id: category.id,
      is_active: true,
    },
  });
  return prisma.productVariant.create({
    data: {
      tenant_id: tenantId,
      product_id: product.id,
      sku: `VERIFY-${randomUUID().slice(0, 8)}`,
      cost_price: new Prisma.Decimal('100.00'),
      is_active: true,
      ...overrides,
    },
  });
}

// --- R1: PurchasingService.costReconciliation() -------------------------------

async function seedCostReconciliationTenant(label) {
  const tenant = await createTenant(`wp-t2-r1-${label}`);
  const category = await createCategory(tenant.id);
  const variant = await createVariant(tenant.id, category);
  // No InventoryCostMovement/InventoryStock rows needed -- the query returns
  // every variant for the tenant regardless of reconciled state (see the
  // header comment above); presence of the row IS the leak signal.
  return { tenant, variant };
}

async function verifyCostReconciliationScoping() {
  const a = await seedCostReconciliationTenant('a');
  const b = await seedCostReconciliationTenant('b');
  const service = new PurchasingService(prisma);

  const resultA = await service.costReconciliation({ tenantId: a.tenant.id });
  const variantIdsA = resultA.map((row) => row.variant_id);

  expectTrue(
    "R1 costReconciliation(tenant A) includes tenant A's own variant",
    variantIdsA.includes(a.variant.id),
  );
  expectTrue(
    "R1 costReconciliation(tenant A) does not include tenant B's variant",
    !variantIdsA.includes(b.variant.id),
    variantIdsA.includes(b.variant.id) ? `leaked variant_id ${b.variant.id}` : undefined,
  );
}

// --- R2: TransfersService.reconcileInTransit() --------------------------------

async function seedInTransitMismatchTenant(label) {
  const tenant = await createTenant(`wp-t2-r2-${label}`);
  const category = await createCategory(tenant.id);
  const variant = await createVariant(tenant.id, category);
  const branchFrom = await createBranch(tenant.id, `${label}-from`);
  const branchTo = await createBranch(tenant.id, `${label}-to`);
  const transfer = await prisma.transfer.create({
    data: {
      tenant_id: tenant.id,
      from_branch_id: branchFrom.id,
      to_branch_id: branchTo.id,
      status: 'shipped',
      transfer_number: `VERIFY-${randomUUID().slice(0, 8)}`,
    },
  });
  // shipped_qty=5, received/damaged/missing=0 -> expected_in_transit=5, but
  // no TransferTransitMovement row exists -> ledger_in_transit=0. 5 != 0 is
  // exactly the mismatch reconcileInTransit's WHERE clause selects.
  const item = await prisma.transferItem.create({
    data: { tenant_id: tenant.id, transfer_id: transfer.id, variant_id: variant.id, qty: 5, shipped_qty: 5 },
  });
  return { tenant, item };
}

async function verifyReconcileInTransitScoping() {
  const a = await seedInTransitMismatchTenant('a');
  const b = await seedInTransitMismatchTenant('b');
  const service = new TransfersService(prisma);
  const actor = { sub: randomUUID(), role: 'owner', branch_id: null, capabilities: [] };

  const resultA = await service.reconcileInTransit({ tenantId: a.tenant.id }, actor);
  const itemIdsA = resultA.mismatches.map((row) => row.transfer_item_id);

  expectTrue(
    "R2 reconcileInTransit(tenant A) includes tenant A's own mismatched item",
    itemIdsA.includes(a.item.id),
  );
  expectTrue(
    "R2 reconcileInTransit(tenant A) does not include tenant B's mismatched item",
    !itemIdsA.includes(b.item.id),
    itemIdsA.includes(b.item.id) ? `leaked transfer_item_id ${b.item.id}` : undefined,
  );
}

// --- R3: InventoryRepository.reconciliationMismatches() -----------------------

async function seedStockMismatchTenant(label) {
  const tenant = await createTenant(`wp-t2-r3-${label}`);
  const category = await createCategory(tenant.id);
  const variant = await createVariant(tenant.id, category);
  const branch = await createBranch(tenant.id, label);
  // qty_on_hand=5 with zero InventoryMovement rows -> ledger_on_hand
  // COALESCEs to 0. 5 != 0 is exactly the mismatch the query selects.
  await prisma.inventoryStock.create({
    data: { tenant_id: tenant.id, branch_id: branch.id, variant_id: variant.id, qty_on_hand: 5 },
  });
  return { tenant, branch, variant };
}

async function verifyReconciliationMismatchesScoping() {
  const a = await seedStockMismatchTenant('a');
  const b = await seedStockMismatchTenant('b');
  const repository = new InventoryRepository(prisma);

  const resultA = await repository.reconciliationMismatches({ tenantId: a.tenant.id });
  const keysA = resultA.map((row) => `${row.branch_id}:${row.variant_id}`);
  const bKey = `${b.branch.id}:${b.variant.id}`;

  expectTrue(
    "R3 reconciliationMismatches(tenant A) includes tenant A's own mismatch",
    keysA.includes(`${a.branch.id}:${a.variant.id}`),
  );
  expectTrue(
    "R3 reconciliationMismatches(tenant A) does not include tenant B's mismatch",
    !keysA.includes(bKey),
    keysA.includes(bKey) ? `leaked branch/variant pair ${bKey}` : undefined,
  );
}

async function main() {
  await verifyCostReconciliationScoping();
  await verifyReconcileInTransitScoping();
  await verifyReconciliationMismatchesScoping();

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll raw-SQL tenant-scoping checks passed\n');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
