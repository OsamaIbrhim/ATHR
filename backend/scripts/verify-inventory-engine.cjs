#!/usr/bin/env node
// Real-Postgres proof of the inventory engine (docs/design/W1-W2-data-core.md
// sections 1, 3 and 4). Constructs the real compiled services against a real
// PrismaClient, so it asserts on the code that ships and requires
// `npm run build` first (see `npm run test:db`).
//
//   E1  branch creation makes its one default warehouse (partial unique index)
//   E2  InventoryService.apply: constant statements for 1 line or 40 lines
//   E3  idempotent replay, and a different command under the same key is refused
//   E4  allowNegative false refuses (and changes nothing), true goes negative
//   E5  two concurrent transactions on one variant serialize; opposite line
//       orders do not deadlock
//   E6  service / non-stock items never touch stock
//   E7  decimal kg quantities: 1.250 accepted at UoM precision 3, refused at 0 / no UoM
//   E8  moving-average cost: receipt, supplier return, reversal, customer return
//       (the numbers of the former purchasing-accounting smoke)
//   E9  a real sale: constant statements for 1 vs 30 lines, service item, negative stock
//   E10 transfer ship / partial receive with damaged units, in-transit ledger
//   E11 reconciliation: clean after all of the above, and it detects a tampered row
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const dist = (...segments) => path.join(__dirname, '..', 'dist', 'src', ...segments);

let InventoryService, InventoryRepository, PurchasingService, SalesService, TransfersService, BranchesRepository,
  PricingService, TaxResolutionService, SalesTaxSnapshotService;
try {
  ({ InventoryService } = require(dist('inventory', 'inventory.service.js')));
  ({ InventoryRepository } = require(dist('inventory', 'inventory.repository.js')));
  ({ PurchasingService } = require(dist('purchasing', 'purchasing.service.js')));
  ({ SalesService } = require(dist('sales', 'sales.service.js')));
  ({ TransfersService } = require(dist('transfers', 'transfers.service.js')));
  ({ BranchesRepository } = require(dist('branches', 'branches.repository.js')));
  ({ PricingService } = require(dist('pricing', 'pricing.service.js')));
  ({ TaxResolutionService } = require(dist('tax', 'tax-resolution.service.js')));
  ({ SalesTaxSnapshotService } = require(dist('tax', 'sales-tax-snapshot.service.js')));
} catch (error) {
  console.error(
    `Could not load compiled services from dist/. This script asserts on the actual shipped code, ` +
      `so it requires \`npm run build\` first. Original error: ${error?.message ?? error}`,
  );
  process.exit(1);
}

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const inventory = new InventoryService(new InventoryRepository(prisma));

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`);
}

// --- statement counting -------------------------------------------------------

let capture = null;
let lastStatements = [];
prisma.$on('query', (event) => {
  if (!capture) return;
  const sql = event.query.trim().toUpperCase();
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SAVEPOINT')) return;
  capture.push(event.query);
});

/** Runs `fn` and returns [result, number of SQL statements it issued (BEGIN/COMMIT excluded)]. */
async function counted(fn) {
  capture = [];
  try {
    const result = await fn();
    return [result, capture.length];
  } finally {
    lastStatements = capture ?? [];
    capture = null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
const D = (value) => new Prisma.Decimal(value);

// --- fixtures -----------------------------------------------------------------

async function createTenantWorld(label) {
  const tenant = await prisma.tenant.create({ data: { name: `engine-${label}-${randomUUID()}`, default_currency: 'EGP' } });
  const context = { tenantId: tenant.id };
  const branches = new BranchesRepository(prisma);
  const branch = await branches.save(context, { code: `E-${randomUUID().slice(0, 8)}`, name_ar: `فرع ${label}` });
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenant_id: tenant.id, branch_id: branch.id, is_default: true } });
  const taxCategory = await prisma.taxCategory.create({
    data: { tenant_id: tenant.id, code: 'STANDARD', name_en: 'Standard', updated_at: new Date() },
  });
  const actor = await prisma.user.create({ data: { name: `Engine actor ${label}`, password_hash: 'not-a-real-hash' } });
  const supplier = await prisma.supplier.create({ data: { tenant_id: tenant.id, name: `Supplier ${label}` } });
  return { tenant, context, branch, warehouse, taxCategory, actor, supplier, branches };
}

async function createVariant(world, overrides = {}) {
  const product = await prisma.product.create({
    data: { tenant_id: world.tenant.id, name_en: `Engine product ${randomUUID()}`, tax_category_id: world.taxCategory.id, is_active: true },
  });
  return prisma.productVariant.create({
    data: {
      tenant_id: world.tenant.id,
      product_id: product.id,
      sku: `ENG-${randomUUID().slice(0, 8)}`,
      cost_price: D(100),
      is_active: true,
      ...overrides,
    },
  });
}

async function createVariants(world, count, overrides = {}) {
  const variants = [];
  for (let i = 0; i < count; i += 1) variants.push(await createVariant(world, overrides));
  return variants;
}

function command(world, overrides) {
  return {
    tenantId: world.tenant.id,
    warehouseId: world.warehouse.id,
    occurredAt: new Date(),
    actorId: world.actor.id,
    type: 'adjustment',
    reference: { type: 'Verify', id: randomUUID() },
    idempotencyKey: `verify:${randomUUID()}`,
    allowNegative: false,
    ...overrides,
  };
}

const apply = (fn) => prisma.$transaction(fn, { maxWait: 15_000, timeout: 60_000 });
const stockOf = (world, variant) =>
  prisma.inventoryStock.findUnique({ where: { warehouse_id_variant_id: { warehouse_id: world.warehouse.id, variant_id: variant.id } } });
const ownerActor = (world) => ({
  sub: world.actor.id,
  membership_role: 'tenant_owner',
  permissions: new Set(),
  scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }],
});

async function rejection(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

// --- E1 -----------------------------------------------------------------------

async function verifySiteModel() {
  const world = await createTenantWorld('e1');
  const defaults = await prisma.warehouse.findMany({ where: { branch_id: world.branch.id } });
  check('E1 creating a branch creates exactly its default warehouse', defaults.length === 1 && defaults[0].is_default === true);

  const duplicate = await rejection(
    prisma.warehouse.create({ data: { tenant_id: world.tenant.id, branch_id: world.branch.id, name: 'second default', is_default: true } }),
  );
  check('E1 a second default warehouse for the same branch is refused', duplicate !== null);

  const secondary = await prisma.warehouse.create({
    data: { tenant_id: world.tenant.id, branch_id: world.branch.id, name: 'back room', is_default: false },
  });
  const central = await prisma.warehouse.create({ data: { tenant_id: world.tenant.id, name: 'central', is_default: true } });
  check('E1 a non-default and a centralized (branch-less) warehouse are allowed', !!secondary && central.branch_id === null);

  const cached = await inventory.defaultWarehouseId(prisma, world.tenant.id, world.branch.id);
  check('E1 the branch default warehouse lookup returns the default', cached === world.warehouse.id);
}

// --- E2 -----------------------------------------------------------------------

async function verifyConstantStatements() {
  const world = await createTenantWorld('e2');
  const variants = await createVariants(world, 41);
  const lines = (list, delta) => list.map((variant) => ({ variantId: variant.id, qtyDelta: delta }));

  // First sight of the variants (rows are created): 1 line vs 40 lines.
  const [, freshOne] = await counted(() =>
    apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: lines(variants.slice(0, 1), 10) }))),
  );
  const [, freshMany] = await counted(() =>
    apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: lines(variants.slice(1, 41), 10) }))),
  );
  check('E2 first-sight rows: 1 line and 40 lines use the same number of statements', freshOne === freshMany, `1 line=${freshOne}, 40 lines=${freshMany}`);

  // Steady state: rows exist. The hot path.
  const [afterOne, steadyOne] = await counted(() =>
    apply((tx) => inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: lines(variants.slice(0, 1), -1) }))),
  );
  const [afterMany, steadyMany] = await counted(() =>
    apply((tx) => inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: lines(variants.slice(1, 41), -1) }))),
  );
  check('E2 steady state: 1 line and 40 lines use the same number of statements', steadyOne === steadyMany, `1 line=${steadyOne}, 40 lines=${steadyMany}`);
  check('E2 a stock command is 3 statements (lock, ledger insert, stock update)', steadyMany === 3, `got ${steadyMany}`);
  check('E2 first sight of a variant adds one statement (create the rows)', freshMany === 4, `got ${freshMany}`);
  check('E2 40 lines return 40 stock-after results with the new balance', afterMany.length === 40 && afterMany.every((row) => row.qtyAfter.equals(9) && row.qtyBefore.equals(10)));
  check('E2 the 1-line command returns its balance', afterOne.length === 1 && afterOne[0].qtyAfter.equals(9));

  const movements = await prisma.inventoryMovement.count({ where: { tenant_id: world.tenant.id, movement_type: 'sale' } });
  check('E2 one ledger row per line with on_hand_after', movements === 41);
  const lastRow = await prisma.inventoryMovement.findFirstOrThrow({ where: { tenant_id: world.tenant.id, variant_id: variants[5].id, movement_type: 'sale' } });
  check('E2 the ledger row carries delta and balance after', lastRow.on_hand_delta.equals(-1) && lastRow.on_hand_after.equals(9));

  const [, costed] = await counted(() =>
    apply((tx) =>
      inventory.apply(tx, command(world, {
        type: 'purchase_receipt',
        costType: 'purchase_receipt',
        lines: variants.slice(0, 40).map((variant) => ({ variantId: variant.id, qtyDelta: 5, unitCost: 80 })),
      })),
    ),
  );
  check('E2 a costed command adds only the cost ledger insert and the variant cost update', costed === 5, `got ${costed}`);
}

// --- E3 -----------------------------------------------------------------------

async function verifyIdempotency() {
  const world = await createTenantWorld('e3');
  const [variant, other] = await createVariants(world, 2);
  const cmd = command(world, { type: 'opening_balance', lines: [{ variantId: variant.id, qtyDelta: 7 }] });

  const first = await apply((tx) => inventory.apply(tx, cmd));
  const replay = await apply((tx) => inventory.apply(tx, cmd));
  const stock = await stockOf(world, variant);
  const rows = await prisma.inventoryMovement.count({ where: { tenant_id: world.tenant.id, idempotency_key: cmd.idempotencyKey } });
  check('E3 replaying a command applies it once', stock.qty_on_hand.equals(7) && rows === 1);
  check('E3 a replay returns the first result', replay.length === 1 && replay[0].qtyAfter.equals(first[0].qtyAfter));

  const different = await rejection(
    apply((tx) => inventory.apply(tx, { ...cmd, lines: [{ variantId: variant.id, qtyDelta: 9 }] })),
  );
  check('E3 the same key with different content is refused', different?.status === 409 || different?.getStatus?.() === 409, different?.message);
  const differentVariant = await rejection(
    apply((tx) => inventory.apply(tx, { ...cmd, lines: [{ variantId: other.id, qtyDelta: 7 }] })),
  );
  check('E3 the same key for another variant is refused', differentVariant !== null);
  check('E3 refused commands changed nothing', (await stockOf(world, variant)).qty_on_hand.equals(7));

  // Keys are tenant-scoped: another tenant can use the same key.
  const world2 = await createTenantWorld('e3b');
  const variant2 = await createVariant(world2);
  await apply((tx) => inventory.apply(tx, { ...command(world2, { lines: [{ variantId: variant2.id, qtyDelta: 1 }] }), idempotencyKey: cmd.idempotencyKey }));
  check('E3 idempotency keys are tenant-scoped', (await stockOf(world2, variant2)).qty_on_hand.equals(1));

  // A replay must not fail on today's (lower) stock.
  const sellCmd = command(world, { type: 'transfer_out', lines: [{ variantId: variant.id, qtyDelta: -7 }] });
  await apply((tx) => inventory.apply(tx, sellCmd));
  const replayEmpty = await apply((tx) => inventory.apply(tx, sellCmd));
  check('E3 replaying a removal that emptied the stock is a replay, not a shortage', replayEmpty.length === 1 && replayEmpty[0].qtyAfter.equals(0));
}

// --- E4 -----------------------------------------------------------------------

async function verifyNegativeStock() {
  const world = await createTenantWorld('e4');
  const [variant] = await createVariants(world, 1);
  await apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: [{ variantId: variant.id, qtyDelta: 2 }] })));

  const refused = await rejection(
    apply((tx) => inventory.apply(tx, command(world, { type: 'transfer_out', lines: [{ variantId: variant.id, qtyDelta: -3 }] }))),
  );
  check('E4 allowNegative=false refuses a removal beyond available stock', refused?.response?.code === 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY', refused?.message);
  const unchanged = await stockOf(world, variant);
  const rows = await prisma.inventoryMovement.count({ where: { tenant_id: world.tenant.id, variant_id: variant.id } });
  check('E4 the refused command left stock and ledger untouched', unchanged.qty_on_hand.equals(2) && rows === 1);

  await prisma.inventoryStock.update({
    where: { warehouse_id_variant_id: { warehouse_id: world.warehouse.id, variant_id: variant.id } },
    data: { qty_reserved: 2 },
  });
  const reserved = await rejection(
    apply((tx) => inventory.apply(tx, command(world, { type: 'transfer_out', lines: [{ variantId: variant.id, qtyDelta: -1 }] }))),
  );
  check('E4 reserved units are not available', reserved?.response?.code === 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY');
  await prisma.inventoryStock.update({
    where: { warehouse_id_variant_id: { warehouse_id: world.warehouse.id, variant_id: variant.id } },
    data: { qty_reserved: 0 },
  });

  const [after] = await apply((tx) =>
    inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: -5 }] })),
  );
  check('E4 allowNegative=true lets an accepted sale go below zero', after.qtyAfter.equals(-3) && (await stockOf(world, variant)).qty_on_hand.equals(-3));
}

// --- E5 -----------------------------------------------------------------------

async function verifyConcurrency() {
  const world = await createTenantWorld('e5');
  const variants = await createVariants(world, 3);
  await apply((tx) =>
    inventory.apply(tx, command(world, { type: 'opening_balance', lines: variants.map((variant) => ({ variantId: variant.id, qtyDelta: 10 })) })),
  );

  const started = Date.now();
  const holder = apply(async (tx) => {
    await inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: variants[0].id, qtyDelta: -1 }] }));
    await sleep(600); // keep the row lock while the second command arrives
  });
  await sleep(150);
  const waiter = apply(async (tx) => {
    const begun = Date.now();
    const [result] = await inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: variants[0].id, qtyDelta: -1 }] }));
    return { result, waitedMs: Date.now() - begun };
  });
  const [, second] = await Promise.all([holder, waiter]);
  const stock = await stockOf(world, variants[0]);
  const afters = (await prisma.inventoryMovement.findMany({
    where: { tenant_id: world.tenant.id, variant_id: variants[0].id, movement_type: 'sale' },
    orderBy: { sequence: 'asc' },
  })).map((row) => Number(row.on_hand_after));
  check('E5 two concurrent commands on one variant serialize', stock.qty_on_hand.equals(8) && afters.join() === '9,8', `stock=${stock.qty_on_hand} afters=${afters}`);
  check('E5 the second command waited for the first one\'s lock', second.waitedMs >= 300 && Date.now() - started >= 600, `waited ${second.waitedMs}ms`);

  // Opposite line orders over the same rows must not deadlock (rows lock in variant order).
  const ids = variants.map((variant) => variant.id);
  const forward = ids.map((variantId) => ({ variantId, qtyDelta: -1 }));
  const backward = [...forward].reverse();
  const results = await Promise.allSettled([
    apply(async (tx) => { await inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: forward })); await sleep(200); }),
    apply(async (tx) => { await inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: backward })); await sleep(200); }),
  ]);
  const totals = await Promise.all(variants.map(async (variant) => Number((await stockOf(world, variant)).qty_on_hand)));
  check('E5 opposite line orders complete without deadlock', results.every((r) => r.status === 'fulfilled'), results.map((r) => r.reason?.message).filter(Boolean).join('; '));
  check('E5 both commands were applied to every variant', totals.join() === '6,8,8', `totals=${totals}`);
}

// --- E6 -----------------------------------------------------------------------

async function verifyItemTypes() {
  const world = await createTenantWorld('e6');
  const stocked = await createVariant(world);
  const service = await createVariant(world, { item_type: 'service' });
  const nonStock = await createVariant(world, { item_type: 'non_stock' });

  const result = await apply((tx) =>
    inventory.apply(tx, command(world, {
      type: 'sale',
      allowNegative: true,
      lines: [stocked, service, nonStock].map((variant) => ({ variantId: variant.id, qtyDelta: -1 })),
    })),
  );
  check('E6 only the stocked variant is returned', result.length === 1 && result[0].variantId === stocked.id);
  const stockRows = await prisma.inventoryStock.findMany({ where: { tenant_id: world.tenant.id } });
  const ledger = await prisma.inventoryMovement.findMany({ where: { tenant_id: world.tenant.id } });
  check('E6 service and non-stock items have no stock row and no movement', stockRows.length === 1 && ledger.length === 1 && ledger[0].variant_id === stocked.id);

  const [onlyService, statements] = await counted(() =>
    apply((tx) => inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: service.id, qtyDelta: -1 }] }))),
  );
  check('E6 a command with only service items does nothing', onlyService.length === 0 && (await prisma.inventoryStock.count({ where: { tenant_id: world.tenant.id } })) === 1 && statements <= 2, `statements=${statements}`);
}

// --- E7 -----------------------------------------------------------------------

async function verifyDecimalQuantities() {
  const world = await createTenantWorld('e7');
  const kg = await prisma.unitOfMeasure.create({ data: { tenant_id: world.tenant.id, code: 'KG', name_en: 'Kilogram', precision: 3 } });
  const piece = await prisma.unitOfMeasure.create({ data: { tenant_id: world.tenant.id, code: 'PC', name_en: 'Piece', precision: 0 } });
  const kgVariant = await createVariant(world, { base_uom_id: kg.id });
  const pieceVariant = await createVariant(world, { base_uom_id: piece.id });
  const plainVariant = await createVariant(world);
  const service = new PurchasingService(prisma, inventory);
  const receive = (variant, qty) =>
    service.receive(world.context, {
      command_id: randomUUID(),
      supplier_id: world.supplier.id,
      branch_id: world.branch.id,
      items: [{ variant_id: variant.id, qty, unit_cost: 10 }],
    }, ownerActor(world));

  await receive(kgVariant, 1.25);
  check('E7 1.250 kg is accepted when the unit allows 3 decimals', (await stockOf(world, kgVariant)).qty_on_hand.equals('1.25'));
  const pieceError = await rejection(receive(pieceVariant, 1.25));
  check('E7 1.250 is rejected when the unit allows 0 decimals', pieceError?.response?.code === 'QUANTITY_PRECISION_EXCEEDED', pieceError?.message);
  const plainError = await rejection(receive(plainVariant, 1.25));
  check('E7 1.250 is rejected for a variant without a unit (default precision 0)', plainError?.response?.code === 'QUANTITY_PRECISION_EXCEEDED');
  await receive(plainVariant, 3);
  check('E7 whole quantities still work everywhere', (await stockOf(world, plainVariant)).qty_on_hand.equals(3));
  const fourDecimals = await rejection(inventory.apply(prisma, command(world, { lines: [{ variantId: kgVariant.id, qtyDelta: '0.0001' }] })));
  check('E7 the engine refuses more than 3 decimals', fourDecimals !== null);

  const lineTotal = await prisma.inventoryMovement.findFirstOrThrow({ where: { tenant_id: world.tenant.id, variant_id: kgVariant.id } });
  check('E7 the ledger keeps the fractional quantity exactly', lineTotal.on_hand_delta.equals('1.25') && lineTotal.on_hand_after.equals('1.25'));
}

// --- E8 -----------------------------------------------------------------------

async function verifyCostAccounting() {
  const world = await createTenantWorld('e8');
  const service = new PurchasingService(prisma, inventory);
  const actor = ownerActor(world);
  const [variant, second] = await createVariants(world, 2);
  const receive = (v, qty, unitCost, extra = {}) =>
    service.receive(world.context, {
      command_id: randomUUID(),
      supplier_id: world.supplier.id,
      branch_id: world.branch.id,
      items: [{ variant_id: v.id, qty, unit_cost: unitCost }],
      ...extra,
    }, actor);

  // 10 units at 100 less a 100 discount = 900 -> weighted average 90.
  const invoice = await receive(variant, 10, 100, { discount_amount: 100 });
  let stock = await stockOf(world, variant);
  let refreshed = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
  check('E8 a discounted receipt moves the average to 90', stock.avg_cost.equals(90) && refreshed.cost_price.equals(90), `avg=${stock.avg_cost} cost_price=${refreshed.cost_price}`);
  const receiptCost = await prisma.inventoryCostMovement.findFirstOrThrow({ where: { purchase_invoice_id: invoice.id } });
  check('E8 the cost movement records before/after quantity and cost', receiptCost.quantity_before.equals(0) && receiptCost.quantity_after.equals(10) && receiptCost.cost_before.equals(100) && receiptCost.cost_after.equals(90) && receiptCost.movement_value.equals(900), show(receiptCost));

  // Second receipt at a different cost: (10*90 + 10*110)/20 = 100.
  await receive(variant, 10, 110);
  stock = await stockOf(world, variant);
  check('E8 a second receipt averages the cost (10 @ 90 + 10 @ 110 = 100)', stock.avg_cost.equals(100) && stock.qty_on_hand.equals(20));

  // Supplier return at the current average; the average does not move.
  const purchase = await service.get(world.context, invoice.id);
  const returned = await service.returnToSupplier(world.context, invoice.id, {
    command_id: randomUUID(), reason: 'damaged', items: [{ purchase_invoice_item_id: purchase.items[0].id, qty: 2 }],
  }, actor);
  stock = await stockOf(world, variant);
  check('E8 a supplier return removes stock at the average and keeps it', stock.qty_on_hand.equals(18) && stock.avg_cost.equals(100));
  check('E8 the return records credit, inventory value removed and variance', Number(returned.credit_total) === 180 && Number(returned.inventory_value_removed) === 200 && Number(returned.purchase_price_variance) === -20, `${returned.credit_total}/${returned.inventory_value_removed}/${returned.purchase_price_variance}`);

  // The first receipt is no longer the latest activity: it cannot be reversed.
  const refused = await rejection(service.reverse(world.context, invoice.id, { reason: 'too late' }, actor));
  check('E8 a receipt with downstream activity cannot be reversed', refused?.status === 409 || refused?.getStatus?.() === 409, refused?.message);

  // An untouched receipt reverses and restores the average it had.
  const untouched = await receive(second, 4, 50);
  await service.reverse(world.context, untouched.id, { reason: 'wrong supplier' }, actor);
  stock = await stockOf(world, second);
  refreshed = await prisma.productVariant.findUniqueOrThrow({ where: { id: second.id } });
  check('E8 reversing an untouched receipt restores stock and the previous cost', stock.qty_on_hand.equals(0) && stock.avg_cost.equals(100) && refreshed.cost_price.equals(100), `qty=${stock.qty_on_hand} avg=${stock.avg_cost}`);
  const reversal = await service.reverse(world.context, untouched.id, { reason: 'wrong supplier' }, actor);
  check('E8 replaying the reversal is idempotent', reversal.status === 'reversed' && (await stockOf(world, second)).qty_on_hand.equals(0));

  // Customer return: the unit re-enters at the cost it was sold at.
  const sold = await prisma.salesInvoice.create({
    data: {
      tenant_id: world.tenant.id, invoice_number: `E8-${randomUUID()}`, branch_id: world.branch.id, status: 'completed',
      subtotal: 120, tax_amount: 0, total: 120, payment_method: 'cash', language: 'ar',
      items: { create: [{ variant_id: second.id, qty: 1, unit_price: 120, unit_cost: 80, unit_tax: 0 }] },
    },
    include: { items: true },
  });
  const sales = new SalesService(prisma, {}, { canViewSaleCostMargin: async () => true }, new SalesTaxSnapshotService(), inventory);
  await sales.createReturn(world.context, { original_invoice_id: sold.id, items: [{ sales_invoice_item_id: sold.items[0].id, qty: 1 }] }, actor);
  stock = await stockOf(world, second);
  refreshed = await prisma.productVariant.findUniqueOrThrow({ where: { id: second.id } });
  check('E8 a customer return into empty stock restores the sale cost (80)', stock.qty_on_hand.equals(1) && stock.avg_cost.equals(80) && refreshed.cost_price.equals(80), `qty=${stock.qty_on_hand} avg=${stock.avg_cost}`);
  const customerCost = await prisma.inventoryCostMovement.findFirst({ where: { tenant_id: world.tenant.id, variant_id: second.id, movement_type: 'customer_return' } });
  check('E8 the customer return is logged as a cost movement', !!customerCost && customerCost.movement_value.equals(80));

  const costReport = await service.costReconciliation(world.context);
  check('E8 cost reconciliation matches the latest cost movement for every variant', costReport.every((row) => row.reconciled), show(costReport.filter((row) => !row.reconciled)));
  return world;
}

// --- E9 -----------------------------------------------------------------------

async function verifySale() {
  const world = await createTenantWorld('e9');
  await prisma.taxCode.create({
    data: {
      tenant_id: world.tenant.id, tax_category_id: world.taxCategory.id, code: 'STANDARD', name_en: 'Standard rate',
      jurisdiction: 'EG', calculation_method: 'percentage', rate: D('14.0000'), tax_mode: 'exclusive', rounding_policy: 'line',
      version: 1, status: 'active', activated_at: new Date(), updated_at: new Date(),
    },
  });
  const book = await prisma.priceBook.create({ data: { tenant_id: world.tenant.id, name: 'Engine book', currency: 'EGP', status: 'active', is_default: true } });
  await prisma.priceBookEntry.create({
    data: { tenant_id: world.tenant.id, price_book_id: book.id, scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 100, allow_zero_price: false, tax_mode: 'exclusive', effective_from: new Date(0), status: 'active' },
  });
  const terminal = await prisma.posTerminal.create({
    data: { tenant_id: world.tenant.id, device_id: randomUUID(), terminal_code: `T-${randomUUID().slice(0, 6)}`, name: 'Till', branch_id: world.branch.id },
  });
  // The sale links a real open shift, cashier and seller (branch-scoped memberships).
  const staff = async (role, name) => {
    const user = await prisma.user.create({ data: { name, password_hash: 'not-a-real-hash' } });
    await prisma.membership.create({
      data: {
        tenant_id: world.tenant.id, user_id: user.id, role, status: 'active',
        access_scope_assignments: { create: { scope_type: 'location', scope_ref_id: world.branch.id, grant_source: 'verify' } },
      },
    });
    return user;
  };
  const cashier = await staff('cashier', 'Cashier');
  const seller = await staff('seller', 'Seller');
  const shift = await prisma.shift.create({ data: { tenant_id: world.tenant.id, branch_id: world.branch.id, opened_by: cashier.id } });
  const tax = new TaxResolutionService(prisma);
  const sales = new SalesService(prisma, new PricingService(prisma, tax), { canViewSaleCostMargin: async () => false }, new SalesTaxSnapshotService(), inventory);

  const stockedVariants = await createVariants(world, 30);
  const serviceVariant = await createVariant(world, { item_type: 'service' });
  const kg = await prisma.unitOfMeasure.create({ data: { tenant_id: world.tenant.id, code: 'KG', name_en: 'Kilogram', precision: 3 } });
  const kgVariant = await createVariant(world, { base_uom_id: kg.id });
  await apply((tx) =>
    inventory.apply(tx, command(world, {
      type: 'opening_balance', costType: 'opening_balance',
      lines: [...stockedVariants, kgVariant].map((variant) => ({ variantId: variant.id, qtyDelta: 10, unitCost: 60 })),
    })),
  );

  let sequence = 0;
  const saleDto = (variants, qtyOf = () => 1) => {
    sequence += 1;
    const items = variants.map((variant) => ({
      variant_id: variant.id, qty: qtyOf(variant), unit_price: 100, unit_tax: 14,
      sku_snapshot: variant.sku, name_ar_snapshot: 'صنف', name_en_snapshot: 'Item',
    }));
    const total = items.reduce((sum, item) => sum.plus(D(item.qty).mul(114)), D(0));
    return {
      event_version: 2, sync_id: randomUUID(), branch_id: world.branch.id, shift_id: shift.id, origin_cashier_id: cashier.id,
      cashier_name_snapshot: 'Cashier', seller_id: seller.id, seller_name_snapshot: 'Seller', offline_session_id: randomUUID(),
      terminal_sequence: String(sequence), occurred_at: new Date().toISOString(), items, payment_method: 'cash', language: 'ar',
      local_total: Number(total.toFixed(2)),
    };
  };
  const sell = (variants, qtyOf) => sales.createSale(saleDto(variants, qtyOf), { id: terminal.id, branch_id: world.branch.id, tenant_id: world.tenant.id });

  await sell(stockedVariants.slice(0, 1)); // warm caches (default warehouse, plans)
  const [oneLine, statementsOne] = await counted(() => sell(stockedVariants.slice(1, 2)));
  const [thirtyLines, statementsMany] = await counted(() => sell(stockedVariants));
  process.stdout.write(`INFO  sale statements: 1 line=${statementsOne}, 30 lines=${statementsMany}\n`);
  if (process.env.INVENTORY_ENGINE_PRINT_SQL) lastStatements.forEach((sql, index) => process.stdout.write(`SQL ${index + 1}: ${sql.replace(/\s+/g, ' ').slice(0, 110)}\n`));
  check('E9 a sale issues the same number of statements for 1 line and for 30 lines', statementsOne === statementsMany, `1 line=${statementsOne}, 30 lines=${statementsMany}`);
  // Ceiling, so the hot path cannot quietly regain round trips (docs/design/W1-W2-data-core.md section 8).
  const SALE_STATEMENT_CEILING = 14;
  check(`E9 a sale stays within ${SALE_STATEMENT_CEILING} statements`, statementsMany <= SALE_STATEMENT_CEILING, `1 line=${statementsOne}, 30 lines=${statementsMany}`);
  const [withCustomer, statementsCustomer] = await counted(() => sales.createSale({ ...saleDto(stockedVariants.slice(6, 7)), customer_phone: '01099999999' }, { id: terminal.id, branch_id: world.branch.id, tenant_id: world.tenant.id }));
  check(`E9 a sale with a customer costs one extra statement (${statementsCustomer})`, statementsCustomer <= SALE_STATEMENT_CEILING + 1 && !!withCustomer.customer_id);
  check('E9 the sale invoice keeps its lines and costs them at the warehouse average (60)', thirtyLines.items.length === 30 && oneLine.items.length === 1);
  const persisted = await prisma.salesInvoiceItem.findFirstOrThrow({ where: { sales_invoice_id: thirtyLines.id } });
  check('E9 the sale line is stamped with the average cost', persisted.unit_cost.equals(60), `unit_cost=${persisted.unit_cost}`);
  check('E9 the sale moved stock and wrote the ledger', (await stockOf(world, stockedVariants[5])).qty_on_hand.equals(9) &&
    (await prisma.inventoryMovement.count({ where: { tenant_id: world.tenant.id, movement_type: 'sale', reference_id: thirtyLines.id } })) === 30);

  const claimed = await prisma.posTerminal.findUniqueOrThrow({ where: { id: terminal.id } });
  check('E9 the terminal high-water mark follows the sale sequence', claimed.last_sale_sequence === BigInt(sequence), `last=${claimed.last_sale_sequence} sequence=${sequence}`);
  const withService = await sell([stockedVariants[0], serviceVariant]);
  check('E9 a sale accepts a service item without any stock row', withService.items.length === 2 && (await prisma.inventoryStock.count({ where: { tenant_id: world.tenant.id, variant_id: serviceVariant.id } })) === 0);

  const kgSale = await sell([kgVariant], () => 1.25);
  check('E9 a kg sale of 1.250 is accepted and moves 1.250 of stock', kgSale.items.length === 1 && (await stockOf(world, kgVariant)).qty_on_hand.equals('8.75'));
  const badKg = await rejection(sell([stockedVariants[2]], () => 1.25));
  check('E9 a fractional quantity for a piece item is rejected', badKg?.response?.code === 'QUANTITY_PRECISION_EXCEEDED', badKg?.message);

  const empty = await createVariant(world);
  const negative = await sell([empty], () => 3);
  check('E9 a sale beyond stock is accepted with a NEGATIVE_STOCK warning', negative.warning_codes.includes('NEGATIVE_STOCK') && (await stockOf(world, empty)).qty_on_hand.equals(-3));

  const dto = saleDto([stockedVariants[3]]);
  const terminalRow = { id: terminal.id, branch_id: world.branch.id, tenant_id: world.tenant.id };
  const firstSale = await sales.createSale(dto, terminalRow);
  const before = (await stockOf(world, stockedVariants[3])).qty_on_hand;
  const replayed = await sales.createSale(dto, terminalRow);
  check('E9 replaying a sale returns the same invoice without moving stock again', replayed.id === firstSale.id && (await stockOf(world, stockedVariants[3])).qty_on_hand.equals(before));
  return world;
}

// --- E10 ----------------------------------------------------------------------

async function verifyTransfers() {
  const world = await createTenantWorld('e10');
  const otherBranch = await world.branches.save(world.context, { code: `E10B-${randomUUID().slice(0, 6)}`, name_ar: 'الفرع الثاني' });
  const otherWarehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenant_id: world.tenant.id, branch_id: otherBranch.id, is_default: true } });
  const [variant] = await createVariants(world, 1);
  await apply((tx) =>
    inventory.apply(tx, command(world, { type: 'opening_balance', costType: 'opening_balance', lines: [{ variantId: variant.id, qtyDelta: 10, unitCost: 70 }] })),
  );
  const service = new TransfersService(prisma, inventory);
  const actor = ownerActor(world);

  const created = await service.create(world.context, { from_branch_id: world.branch.id, to_branch_id: otherBranch.id, command_id: randomUUID(), items: [{ variant_id: variant.id, qty: 4 }] }, actor);
  const shipped = await service.ship(world.context, created.id, { command_id: randomUUID() }, actor);
  const source = await stockOf(world, variant);
  check('E10 shipping takes the goods out of the source default warehouse', shipped.status === 'shipped' && source.qty_on_hand.equals(6));
  const item = await prisma.transferItem.findFirstOrThrow({ where: { transfer_id: created.id } });
  check('E10 the shipped line remembers the source average cost', item.shipped_qty.equals(4) && item.unit_cost.equals(70));

  const receiveCommand = randomUUID();
  const received = await service.receive(world.context, created.id, { command_id: receiveCommand, items: [{ transfer_item_id: item.id, received_qty: 3, damaged_qty: 1 }] }, actor);
  const destination = await prisma.inventoryStock.findUniqueOrThrow({ where: { warehouse_id_variant_id: { warehouse_id: otherWarehouse.id, variant_id: variant.id } } });
  check('E10 receiving adds only the received units, at the shipped cost', received.status === 'received' && destination.qty_on_hand.equals(3) && destination.avg_cost.equals(70), `qty=${destination.qty_on_hand} avg=${destination.avg_cost}`);
  await service.receive(world.context, created.id, { command_id: receiveCommand, items: [{ transfer_item_id: item.id, received_qty: 3, damaged_qty: 1 }] }, actor);
  check('E10 replaying the receipt command changes nothing', (await prisma.inventoryStock.findUniqueOrThrow({ where: { warehouse_id_variant_id: { warehouse_id: otherWarehouse.id, variant_id: variant.id } } })).qty_on_hand.equals(3));

  const transit = await prisma.transferTransitMovement.findMany({ where: { transfer_id: created.id }, orderBy: { sequence: 'asc' } });
  check('E10 the in-transit ledger reads shipped 4, received -3, damaged -1 down to 0',
    transit.map((row) => `${row.movement_type}:${row.quantity_delta}:${row.in_transit_after}`).join() === 'shipped:4:4,received:-3:1,damaged:-1:0', transit.map((row) => `${row.movement_type}:${row.quantity_delta}:${row.in_transit_after}`).join());
  const reconciled = await service.reconcileInTransit(world.context, actor);
  check('E10 in-transit reconciliation is clean', reconciled.ok === true);

  const other = await createVariant(world);
  const tooMuch = await service.create(world.context, { from_branch_id: world.branch.id, to_branch_id: otherBranch.id, command_id: randomUUID(), items: [{ variant_id: other.id, qty: 1 }] }, actor);
  const refused = await rejection(service.ship(world.context, tooMuch.id, { command_id: randomUUID() }, actor));
  check('E10 shipping more than the source holds is refused', refused?.response?.code === 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY', refused?.message);
  check('E10 the refused shipment left the transfer pending', (await prisma.transfer.findUniqueOrThrow({ where: { id: tooMuch.id } })).status === 'pending');
}

// --- E11 ----------------------------------------------------------------------

async function verifyReconciliation(worlds) {
  for (const world of worlds) {
    const report = await inventory.reconcile(world.context);
    check(`E11 stock equals the sum of its ledger (${world.tenant.name.split('-')[1]})`, report.is_consistent === true, show(report.items.slice(0, 2)));
  }

  const world = await createTenantWorld('e11');
  const [variant] = await createVariants(world, 1);
  await apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: [{ variantId: variant.id, qtyDelta: 5 }] })));
  check('E11 a fresh warehouse reconciles', (await inventory.reconcile(world.context)).is_consistent === true);
  await prisma.$executeRaw`UPDATE "InventoryStock" SET "qty_on_hand" = "qty_on_hand" + 1 WHERE "tenant_id" = ${world.tenant.id}::uuid`;
  const tampered = await inventory.reconcile(world.context);
  check('E11 a stock row that drifted from its ledger is reported', tampered.mismatch_count === 1 && tampered.items[0].on_hand_difference === 1, show(tampered.items));
  const scoped = await inventory.reconcile(world.context, world.branch.id);
  check('E11 reconciliation can be scoped to a branch', scoped.mismatch_count === 1);
}

async function main() {
  await verifySiteModel();
  await verifyConstantStatements();
  await verifyIdempotency();
  await verifyNegativeStock();
  await verifyConcurrency();
  await verifyItemTypes();
  await verifyDecimalQuantities();
  const cost = await verifyCostAccounting();
  const sale = await verifySale();
  await verifyTransfers();
  await verifyReconciliation([cost, sale]);

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll inventory engine checks passed\n');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
