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
//
// WP-009 Phase 0 / defect 1 addition -- W1/W2 below:
// purchasing.service.ts:717-721 (supplier return) and :1046-1050 (purchase
// reversal) run the same shape of raw UPDATE as :1000 above -- WHERE
// branch_id = ... AND variant_id = ..., no tenant_id predicate -- but this
// pair WRITES/locks a real row, so unlike :1000 it is not covered by
// verify-tenant-constraints.cjs's read-side FK proof alone. The schema
// reasoning (composite FK InventoryStock(tenant_id, branch_id) -> Branch,
// InventoryStock(tenant_id, variant_id) -> ProductVariant, both Branch.id and
// ProductVariant.id globally unique, PLUS invoice.branch_id and
// item.variant_id already being sourced from a tenant-scoped
// purchaseInvoice.findFirst({tenant_id: context.tenantId}) lookup chained
// through PurchaseInvoice's own composite FKs) says these two sites were
// already structurally safe -- see the PR description for the full chain and
// the migrations that added each composite FK. `tenant_id` was still added
// to both predicates as defence in depth, matching transfers.service.ts:240.
// W1/W2 prove two things against real Postgres: (a) tenant A's own
// supplier-return / purchase-reversal call only ever touches tenant A's
// InventoryStock row, never tenant B's otherwise-identical row, and (b) the
// three `Insufficient ... stock` throw sites (defect 2) now carry
// INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY through `toFriendlyError`
// instead of falling through to the generic 409 CONFLICT fallback.
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const distPurchasing = path.join(__dirname, '..', 'dist', 'src', 'purchasing', 'purchasing.service.js');
const distTransfers = path.join(__dirname, '..', 'dist', 'src', 'transfers', 'transfers.service.js');
const distInventoryRepo = path.join(__dirname, '..', 'dist', 'src', 'inventory', 'inventory.repository.js');
const distApiErrorFilter = path.join(__dirname, '..', 'dist', 'src', 'common', 'api-error.filter.js');

let PurchasingService, TransfersService, InventoryRepository, toFriendlyError;
try {
  ({ PurchasingService } = require(distPurchasing));
  ({ TransfersService } = require(distTransfers));
  ({ InventoryRepository } = require(distInventoryRepo));
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

async function createSupplier(tenantId, label) {
  return prisma.supplier.create({
    data: { tenant_id: tenantId, name: `Verify supplier ${label}-${randomUUID().slice(0, 8)}` },
  });
}

// PurchaseInvoice/SupplierReturn.created_by is a real FK to User(id) (not
// tenant-scoped -- User has no tenant_id, identities are scoped through
// Membership), so the acting user must actually exist. Created once in
// main() below; ownerActor.sub is filled in before any W1/W2 fixture runs.
const ownerActor = { sub: null, role: 'owner', branch_id: null, capabilities: [] };

async function createVerifyActorUser() {
  const user = await prisma.user.create({
    data: {
      name: 'Verify actor',
      password_hash: 'not-a-real-hash',
      role: 'owner',
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
  const branch = await createBranch(tenant.id, label);
  const supplier = await createSupplier(tenant.id, label);
  const variantOk = await createVariant(tenant.id, category);
  const variantShort = await createVariant(tenant.id, category);
  return { tenant, branch, supplier, variantOk, variantShort };
}

// Deliberately does NOT call PurchasingService.receive(): that method's
// `tx.purchaseInvoice.create({ data: { items: { create: [{ tenant_id, ... }] } } })`
// throws `PrismaClientValidationError: Unknown argument tenant_id` against
// real Postgres/Prisma (confirmed by isolated repro -- the generated
// `PurchaseInvoiceItemUncheckedCreateWithoutPurchase_invoiceInput` type does
// not carry `tenant_id`, unlike a top-level `purchaseInvoiceItem.create()`,
// which does). fakePrisma never validates argument shape, so no jest spec
// has ever caught this; `prisma/seed.ts`'s own nested items independently
// omit `tenant_id` (matching the type), which is what exposed the
// discrepancy. This is a real, separate, out-of-scope defect -- reported in
// the PR description, not fixed here. This helper reproduces `receive()`'s
// net effect (posted invoice + item + InventoryStock + the same
// record_inventory_movement/record_inventory_cost_movement calls with the
// same idempotency-key convention `purchase-receipt:`/`purchase-cost:` that
// reverse() looks up) via the same DB functions, split across two `create`
// calls instead of one nested call, so W1/W2 below can still exercise the
// real `returnToSupplier()`/`reverse()` code under test.
async function receiveStock(tenant, fixture, variant, qty) {
  const unitCost = new Prisma.Decimal('10.00');
  const lineTotal = unitCost.mul(qty);
  const invoice = await prisma.purchaseInvoice.create({
    data: {
      tenant_id: tenant.id,
      supplier_id: fixture.supplier.id,
      branch_id: fixture.branch.id,
      status: 'posted',
      accounting_version: 2,
      subtotal: lineTotal,
      total: lineTotal,
    },
  });
  const item = await prisma.purchaseInvoiceItem.create({
    data: {
      tenant_id: tenant.id,
      purchase_invoice_id: invoice.id,
      variant_id: variant.id,
      qty,
      unit_cost: unitCost,
      line_subtotal: lineTotal,
      allocated_discount: new Prisma.Decimal('0'),
      net_line_total: lineTotal,
      net_unit_cost: unitCost,
    },
  });
  const receivedAt = new Date();
  await prisma.inventoryStock.upsert({
    where: { branch_id_variant_id: { branch_id: fixture.branch.id, variant_id: variant.id } },
    update: { qty_on_hand: { increment: qty } },
    create: { tenant_id: tenant.id, branch_id: fixture.branch.id, variant_id: variant.id, qty_on_hand: qty },
  });
  await prisma.$queryRaw`
    SELECT "record_inventory_movement"(
      ${fixture.branch.id}::uuid, ${variant.id}::uuid, 'purchase_receipt'::"InventoryMovementType",
      ${qty}::integer, 0::integer, 'PurchaseInvoice'::text, ${invoice.id}::text, ${item.id}::text,
      ${`purchase-receipt:${item.id}`}::text, ${receivedAt}::timestamp, ${ownerActor.sub}::uuid, '{}'::jsonb
    )
  `;
  await prisma.$queryRaw`
    SELECT "record_inventory_cost_movement"(
      ${variant.id}::uuid, ${fixture.branch.id}::uuid, 'purchase_receipt'::"InventoryCostMovementType",
      ${qty}::integer, ${lineTotal.toFixed(2)}::numeric, 'PurchaseInvoice'::text, ${invoice.id}::text, ${item.id}::text,
      ${invoice.id}::uuid, ${item.id}::uuid, NULL::uuid, NULL::uuid, ${`purchase-cost:${item.id}`}::text,
      ${receivedAt}::timestamp, ${ownerActor.sub}::uuid, NULL::numeric, '{}'::jsonb
    )
  `;
  return prisma.purchaseInvoice.findFirstOrThrow({ where: { id: invoice.id }, include: { items: true } });
}

async function forceInsufficientUnreservedStock(branchId, variantId) {
  // Bumps qty_reserved without touching qty_on_hand, so
  // InventoryStock_reserved_not_above_available_on_hand stays satisfied
  // (qty_reserved=1 <= qty_on_hand) while the raw UPDATE's own
  // `(qty_on_hand - qty) >= qty_reserved` predicate fails for a full-qty
  // return/reversal. Chosen over reducing qty_on_hand directly because
  // reverse() separately verifies the global on-hand aggregate matches the
  // receipt's recorded snapshot (purchasing.service.ts:1000-1039) before it
  // ever reaches the raw UPDATE -- reducing qty_on_hand out of band would
  // trip that unrelated guard instead of the one this check targets.
  await prisma.inventoryStock.update({
    where: { branch_id_variant_id: { branch_id: branchId, variant_id: variantId } },
    data: { qty_reserved: 1 },
  });
}

// --- W1: PurchasingService.returnToSupplier() -- purchasing.service.ts:714-726 ---

async function verifySupplierReturnScoping() {
  const a = await seedPurchasingTenant('w1a');
  const b = await seedPurchasingTenant('w1b');
  const service = new PurchasingService(prisma);
  const contextA = { tenantId: a.tenant.id };

  const invoiceA = await receiveStock(a.tenant, a, a.variantOk, 5);
  await receiveStock(b.tenant, b, b.variantOk, 5);
  const bStockBefore = await prisma.inventoryStock.findUniqueOrThrow({
    where: { branch_id_variant_id: { branch_id: b.branch.id, variant_id: b.variantOk.id } },
  });

  await service.returnToSupplier(
    contextA,
    invoiceA.id,
    { command_id: randomUUID(), reason: 'verify tenant scoping', items: [{ purchase_invoice_item_id: invoiceA.items[0].id, qty: 2 }] },
    ownerActor,
  );

  const aStockAfter = await prisma.inventoryStock.findUniqueOrThrow({
    where: { branch_id_variant_id: { branch_id: a.branch.id, variant_id: a.variantOk.id } },
  });
  const bStockAfter = await prisma.inventoryStock.findUniqueOrThrow({
    where: { branch_id_variant_id: { branch_id: b.branch.id, variant_id: b.variantOk.id } },
  });

  expectTrue(
    "W1 returnToSupplier(tenant A) decrements exactly tenant A's own row",
    aStockAfter.qty_on_hand === 3,
    `expected 3, got ${aStockAfter.qty_on_hand}`,
  );
  expectTrue(
    "W1 returnToSupplier(tenant A) does not touch tenant B's identically-shaped row",
    bStockAfter.qty_on_hand === bStockBefore.qty_on_hand,
    `tenant B qty_on_hand moved from ${bStockBefore.qty_on_hand} to ${bStockAfter.qty_on_hand}`,
  );

  const invoiceA2 = await receiveStock(a.tenant, a, a.variantShort, 5);
  await forceInsufficientUnreservedStock(a.branch.id, a.variantShort.id);

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
  const service = new PurchasingService(prisma);
  const contextA = { tenantId: a.tenant.id };

  const invoiceA = await receiveStock(a.tenant, a, a.variantOk, 5);
  await receiveStock(b.tenant, b, b.variantOk, 5);
  const bStockBefore = await prisma.inventoryStock.findUniqueOrThrow({
    where: { branch_id_variant_id: { branch_id: b.branch.id, variant_id: b.variantOk.id } },
  });

  await service.reverse(contextA, invoiceA.id, { reason: 'verify tenant scoping' }, ownerActor);

  const aStockAfter = await prisma.inventoryStock.findUniqueOrThrow({
    where: { branch_id_variant_id: { branch_id: a.branch.id, variant_id: a.variantOk.id } },
  });
  const bStockAfter = await prisma.inventoryStock.findUniqueOrThrow({
    where: { branch_id_variant_id: { branch_id: b.branch.id, variant_id: b.variantOk.id } },
  });

  expectTrue(
    "W2 reverse(tenant A) decrements exactly tenant A's own row",
    aStockAfter.qty_on_hand === 0,
    `expected 0, got ${aStockAfter.qty_on_hand}`,
  );
  expectTrue(
    "W2 reverse(tenant A) does not touch tenant B's identically-shaped row",
    bStockAfter.qty_on_hand === bStockBefore.qty_on_hand,
    `tenant B qty_on_hand moved from ${bStockBefore.qty_on_hand} to ${bStockAfter.qty_on_hand}`,
  );

  const invoiceA2 = await receiveStock(a.tenant, a, a.variantShort, 5);
  await forceInsufficientUnreservedStock(a.branch.id, a.variantShort.id);

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
