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
//   R1 PurchasingService.costReconciliation()
//   R2 TransfersService.reconcileInTransit()
//   R3 InventoryRepository.reconciliationMismatches()
//
// The stock writes of supplier returns and purchase reversals now go through
// InventoryService.apply(), whose statements bind tenant_id and the warehouse
// (InventoryStock is keyed by (warehouse_id, variant_id) with composite
// tenant FKs). W1/W2 below prove against real Postgres that (a) tenant A's own
// supplier-return / purchase-reversal only ever touches tenant A's
// InventoryStock row, never tenant B's otherwise-identical row, and (b) the
// insufficient-stock refusal carries INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY
// through `toFriendlyError` instead of falling through to the generic 409.
// The full engine behaviour is proven by verify-inventory-engine.cjs.
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const distPurchasing = path.join(__dirname, '..', 'dist', 'src', 'purchasing', 'purchasing.service.js');
const distTransfers = path.join(__dirname, '..', 'dist', 'src', 'transfers', 'transfers.service.js');
const distInventoryRepo = path.join(__dirname, '..', 'dist', 'src', 'inventory', 'inventory.repository.js');
const distInventoryService = path.join(__dirname, '..', 'dist', 'src', 'inventory', 'inventory.service.js');
const distApiErrorFilter = path.join(__dirname, '..', 'dist', 'src', 'common', 'api-error.filter.js');

let PurchasingService, TransfersService, InventoryRepository, InventoryService, toFriendlyError;
try {
  ({ PurchasingService } = require(distPurchasing));
  ({ TransfersService } = require(distTransfers));
  ({ InventoryRepository } = require(distInventoryRepo));
  ({ InventoryService } = require(distInventoryService));
  ({ toFriendlyError } = require(distApiErrorFilter));
} catch (error) {
  console.error(
    `Could not load compiled services from dist/. This script asserts on the ` +
      `actual shipped code, so it requires \`npm run build\` to have run first. ` +
      `Original error: ${error?.message ?? error}`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();
const inventoryService = new InventoryService(new InventoryRepository(prisma));

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

// A branch's stock lives in its default warehouse.
async function createBranchWithWarehouse(tenantId, label) {
  const branch = await createBranch(tenantId, label);
  const warehouse = await prisma.warehouse.create({
    data: { tenant_id: tenantId, branch_id: branch.id, name: `${label} default warehouse`, is_default: true },
  });
  return { branch, warehouse };
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

async function createSupplier(tenantId, label) {
  return prisma.supplier.create({
    data: { tenant_id: tenantId, name: `Verify supplier ${label}-${randomUUID().slice(0, 8)}` },
  });
}

// PurchaseInvoice/SupplierReturn.created_by is a real FK to User(id) (not
// tenant-scoped -- User has no tenant_id, identities are scoped through
// Membership), so the acting user must actually exist. Created once in
// main() below; ownerActor.sub is filled in before any W1/W2 fixture runs.
const ownerActor = { sub: null, membership_role: 'tenant_owner', permissions: new Set(), scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }] };

async function createVerifyActorUser() {
  const user = await prisma.user.create({
    data: {
      name: 'Verify actor',
      password_hash: 'not-a-real-hash',
    },
  });
  ownerActor.sub = user.id;
}

// --- W1/W2 shared fixture: a tenant with a branch/supplier and two variants,
// one ("Ok") used to prove tenant-scoping on a successful operation, one
// ("Short") used to force the insufficient-unreserved-stock throw without
// touching qty_on_hand (see header) so reverse()'s separate downstream-
// activity guard, which reads qty_on_hand not qty_reserved, stays satisfied.

async function seedPurchasingTenant(label) {
  const tenant = await createTenant(`wp009-p0-w-${label}`);
  const category = await createCategory(tenant.id);
  const { branch, warehouse } = await createBranchWithWarehouse(tenant.id, label);
  const supplier = await createSupplier(tenant.id, label);
  const variantOk = await createVariant(tenant.id, category);
  const variantShort = await createVariant(tenant.id, category);
  return { tenant, branch, warehouse, supplier, variantOk, variantShort };
}

// Receives stock through the real PurchasingService.receive() (which posts the
// stock and cost ledgers through InventoryService), 10.00 per unit.
async function receiveStock(tenant, fixture, variant, qty) {
  const service = new PurchasingService(prisma, inventoryService);
  return service.receive(
    { tenantId: tenant.id },
    { command_id: randomUUID(), supplier_id: fixture.supplier.id, branch_id: fixture.branch.id, items: [{ variant_id: variant.id, qty, unit_cost: 10 }] },
    ownerActor,
  );
}

async function forceInsufficientUnreservedStock(warehouseId, variantId) {
  // Bumps qty_reserved without touching qty_on_hand, so
  // InventoryStock_reserved_not_above_available_on_hand stays satisfied
  // (qty_reserved=1 <= qty_on_hand) while InventoryService's availability
  // check (on_hand - qty >= reserved) fails for a full-qty return/reversal.
  await prisma.inventoryStock.update({
    where: { warehouse_id_variant_id: { warehouse_id: warehouseId, variant_id: variantId } },
    data: { qty_reserved: 1 },
  });
}

// --- W1: PurchasingService.returnToSupplier() -- purchasing.service.ts:714-726 ---

async function verifySupplierReturnScoping() {
  const a = await seedPurchasingTenant('w1a');
  const b = await seedPurchasingTenant('w1b');
  const service = new PurchasingService(prisma, inventoryService);
  const contextA = { tenantId: a.tenant.id };

  const invoiceA = await receiveStock(a.tenant, a, a.variantOk, 5);
  await receiveStock(b.tenant, b, b.variantOk, 5);
  const bStockBefore = await prisma.inventoryStock.findUniqueOrThrow({
    where: { warehouse_id_variant_id: { warehouse_id: b.warehouse.id, variant_id: b.variantOk.id } },
  });

  await service.returnToSupplier(
    contextA,
    invoiceA.id,
    { command_id: randomUUID(), reason: 'verify tenant scoping', items: [{ purchase_invoice_item_id: invoiceA.items[0].id, qty: 2 }] },
    ownerActor,
  );

  const aStockAfter = await prisma.inventoryStock.findUniqueOrThrow({
    where: { warehouse_id_variant_id: { warehouse_id: a.warehouse.id, variant_id: a.variantOk.id } },
  });
  const bStockAfter = await prisma.inventoryStock.findUniqueOrThrow({
    where: { warehouse_id_variant_id: { warehouse_id: b.warehouse.id, variant_id: b.variantOk.id } },
  });

  expectTrue(
    "W1 returnToSupplier(tenant A) decrements exactly tenant A's own row",
    Number(aStockAfter.qty_on_hand) === 3,
    `expected 3, got ${aStockAfter.qty_on_hand}`,
  );
  expectTrue(
    "W1 returnToSupplier(tenant A) does not touch tenant B's identically-shaped row",
    bStockAfter.qty_on_hand.equals(bStockBefore.qty_on_hand),
    `tenant B qty_on_hand moved from ${bStockBefore.qty_on_hand} to ${bStockAfter.qty_on_hand}`,
  );

  const invoiceA2 = await receiveStock(a.tenant, a, a.variantShort, 5);
  await forceInsufficientUnreservedStock(a.warehouse.id, a.variantShort.id);

  let caught = null;
  try {
    await service.returnToSupplier(
      contextA,
      invoiceA2.id,
      { command_id: randomUUID(), reason: 'verify insufficient stock', items: [{ purchase_invoice_item_id: invoiceA2.items[0].id, qty: 5 }] },
      ownerActor,
    );
  } catch (error) {
    caught = error;
  }
  expectTrue('W1 insufficient unreserved stock throws on the raw UPDATE', caught !== null);
  if (caught) {
    const friendly = toFriendlyError(caught);
    expectTrue(
      'W1 insufficient-stock exception maps to 409 INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
      friendly.status === 409 && friendly.code === 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
      `got ${JSON.stringify({ status: friendly.status, code: friendly.code })}`,
    );
  }
}

// --- W2: PurchasingService.reverse() -- purchasing.service.ts:1043-1055 ---

async function verifyPurchaseReversalScoping() {
  const a = await seedPurchasingTenant('w2a');
  const b = await seedPurchasingTenant('w2b');
  const service = new PurchasingService(prisma, inventoryService);
  const contextA = { tenantId: a.tenant.id };

  const invoiceA = await receiveStock(a.tenant, a, a.variantOk, 5);
  await receiveStock(b.tenant, b, b.variantOk, 5);
  const bStockBefore = await prisma.inventoryStock.findUniqueOrThrow({
    where: { warehouse_id_variant_id: { warehouse_id: b.warehouse.id, variant_id: b.variantOk.id } },
  });

  await service.reverse(contextA, invoiceA.id, { reason: 'verify tenant scoping' }, ownerActor);

  const aStockAfter = await prisma.inventoryStock.findUniqueOrThrow({
    where: { warehouse_id_variant_id: { warehouse_id: a.warehouse.id, variant_id: a.variantOk.id } },
  });
  const bStockAfter = await prisma.inventoryStock.findUniqueOrThrow({
    where: { warehouse_id_variant_id: { warehouse_id: b.warehouse.id, variant_id: b.variantOk.id } },
  });

  expectTrue(
    "W2 reverse(tenant A) decrements exactly tenant A's own row",
    Number(aStockAfter.qty_on_hand) === 0,
    `expected 0, got ${aStockAfter.qty_on_hand}`,
  );
  expectTrue(
    "W2 reverse(tenant A) does not touch tenant B's identically-shaped row",
    bStockAfter.qty_on_hand.equals(bStockBefore.qty_on_hand),
    `tenant B qty_on_hand moved from ${bStockBefore.qty_on_hand} to ${bStockAfter.qty_on_hand}`,
  );

  const invoiceA2 = await receiveStock(a.tenant, a, a.variantShort, 5);
  await forceInsufficientUnreservedStock(a.warehouse.id, a.variantShort.id);

  let caught = null;
  try {
    await service.reverse(contextA, invoiceA2.id, { reason: 'verify insufficient stock' }, ownerActor);
  } catch (error) {
    caught = error;
  }
  expectTrue('W2 insufficient unreserved stock throws on the raw UPDATE', caught !== null);
  if (caught) {
    const friendly = toFriendlyError(caught);
    expectTrue(
      'W2 insufficient-stock exception maps to 409 INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
      friendly.status === 409 && friendly.code === 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
      `got ${JSON.stringify({ status: friendly.status, code: friendly.code })}`,
    );
  }
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
  const service = new PurchasingService(prisma, inventoryService);

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
  const service = new TransfersService(prisma, inventoryService);
  const actor = { sub: randomUUID(), membership_role: 'tenant_owner', permissions: new Set(), scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }] };

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
  const { branch, warehouse } = await createBranchWithWarehouse(tenant.id, label);
  // qty_on_hand=5 with zero InventoryMovement rows -> ledger_on_hand
  // COALESCEs to 0. 5 != 0 is exactly the mismatch the query selects.
  await prisma.inventoryStock.create({
    data: { tenant_id: tenant.id, warehouse_id: warehouse.id, variant_id: variant.id, qty_on_hand: 5 },
  });
  return { tenant, branch, warehouse, variant };
}

async function verifyReconciliationMismatchesScoping() {
  const a = await seedStockMismatchTenant('a');
  const b = await seedStockMismatchTenant('b');
  const repository = new InventoryRepository(prisma);

  const resultA = await repository.reconciliationMismatches({ tenantId: a.tenant.id });
  const keysA = resultA.map((row) => `${row.warehouse_id}:${row.variant_id}`);
  const bKey = `${b.warehouse.id}:${b.variant.id}`;

  expectTrue(
    "R3 reconciliationMismatches(tenant A) includes tenant A's own mismatch",
    keysA.includes(`${a.warehouse.id}:${a.variant.id}`),
  );
  expectTrue(
    "R3 reconciliationMismatches(tenant A) does not include tenant B's mismatch",
    !keysA.includes(bKey),
    keysA.includes(bKey) ? `leaked warehouse/variant pair ${bKey}` : undefined,
  );
}

async function main() {
  await verifyCostReconciliationScoping();
  await verifyReconcileInTransitScoping();
  await verifyReconciliationMismatchesScoping();
  await createVerifyActorUser();
  await verifySupplierReturnScoping();
  await verifyPurchaseReversalScoping();

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll raw-SQL tenant-scoping checks passed\n');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
