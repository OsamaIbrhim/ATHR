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
//   E18 tracked documents: purchase receive, POS 1.6.0 sale, customer return, supplier return, transfer refusal
//   E17 enabling tracking: plan feature, zero stock, precision-0 unit, sync change
//   E12-E16 serial / batch tracking (docs/design/W2b-tracking.md): serial receive/sale/return,
//       FEFO, unallocated shortfall + settlement, replay, reconcile invariants, concurrency
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const dist = (...segments) => path.join(__dirname, '..', 'dist', 'src', ...segments);

let InventoryService, InventoryRepository, PurchasingService, SalesService, TransfersService, BranchesRepository,
  PricingService, TaxResolutionService, SalesTaxSnapshotService, ProductsService, ProductsRepository, BrandsRepository,
  TaxCodeService, TaxCodeRepository, LimitService, EntitlementService, ProductTypesService;
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
  ({ ProductsService } = require(dist('products', 'products.service.js')));
  ({ ProductsRepository } = require(dist('products', 'products.repository.js')));
  ({ BrandsRepository } = require(dist('brands', 'brands.repository.js')));
  ({ TaxCodeService } = require(dist('tax', 'tax-code.service.js')));
  ({ TaxCodeRepository } = require(dist('tax', 'tax-code.repository.js')));
  ({ LimitService } = require(dist('entitlements', 'limit.service.js')));
  ({ EntitlementService } = require(dist('entitlements', 'entitlement.service.js')));
  ({ ProductTypesService } = require(dist('catalog', 'product-types.service.js')));
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
  const SALE_STATEMENT_CEILING = 16;
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

// --- E12-E17: serial / batch tracking (docs/design/W2b-tracking.md) --------------

const lotsOf = (world, variant) =>
  prisma.$queryRaw`
    SELECT COALESCE(SUM(lm."qty_delta"), 0) AS "total", COUNT(*)::int AS "rows"
    FROM "InventoryLotMovement" lm
    JOIN "InventoryMovement" m ON m."id" = lm."movement_id"
    WHERE m."tenant_id" = ${world.tenant.id}::uuid AND m."variant_id" = ${variant.id}::uuid
  `.then(([row]) => ({ total: Number(row.total), rows: row.rows }));
const serialsOf = async (world, variant) =>
  Object.fromEntries((await prisma.inventorySerial.findMany({ where: { tenant_id: world.tenant.id, variant_id: variant.id }, orderBy: { serial: 'asc' } })).map((row) => [row.serial, row.status]));
const batchesOf = async (world, variant) =>
  Object.fromEntries((await prisma.inventoryBatch.findMany({ where: { tenant_id: world.tenant.id, variant_id: variant.id }, orderBy: { batch_no: 'asc' } })).map((row) => [row.batch_no || '(unallocated)', Number(row.qty)]));
const day = (row) => row?.expiry_date?.toISOString().slice(0, 10) ?? null;
const codeOf = (error) => error?.response?.code;
const receiveLots = (world, variant, lots, qty, extra = {}) =>
  apply((tx) => inventory.apply(tx, command(world, { type: 'purchase_receipt', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: qty, lots }], ...extra })));
const sellLots = (world, variant, qty, lots, extra = {}) =>
  apply((tx) => inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: -qty, lots }], ...extra })));

async function verifySerialTracking() {
  const world = await createTenantWorld('e12');
  const variant = await createVariant(world, { tracking: 'serial' });
  const plain = await createVariant(world);
  await apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: [{ variantId: plain.id, qtyDelta: 10 }] })));

  await receiveLots(world, variant, { serials: ['S1', 'S2', 'S3'] }, 3);
  check('E12 receiving serials puts each in stock and adds them to on hand', (await stockOf(world, variant)).qty_on_hand.equals(3)
    && show(await serialsOf(world, variant)) === show({ S1: 'in_stock', S2: 'in_stock', S3: 'in_stock' }));
  check('E12 each serial has its own +1 lot movement', show(await lotsOf(world, variant)) === show({ total: 3, rows: 3 }));

  const duplicate = await rejection(receiveLots(world, variant, { serials: ['S3', 'S4'] }, 2));
  check('E12 a serial already in stock is refused on receive, and nothing of that command remains',
    codeOf(duplicate) === 'TRACKING_SERIAL_ALREADY_IN_STOCK' && !('S4' in (await serialsOf(world, variant))) && (await stockOf(world, variant)).qty_on_hand.equals(3), duplicate?.message);
  const wrongCount = await rejection(receiveLots(world, variant, { serials: ['S5'] }, 2));
  check('E12 receiving fewer serials than units is refused', codeOf(wrongCount) === 'TRACKING_SERIALS_REQUIRED');

  // Statement counts: an untracked sale is 3 statements; a tracked one adds a fixed number.
  const [, untracked] = await counted(() => sellLots(world, plain, 1));
  const [afterSale, trackedSale] = await counted(() => sellLots(world, variant, 1, { serials: ['S1'] }));
  const [, notCapturedSale] = await counted(() => sellLots(world, variant, 1));
  check('E12 an untracked sale is still 3 statements', untracked === 3, `got ${untracked}`);
  check('E12 a serial sale adds two statements (lock-read + write)', trackedSale === untracked + 2, `got ${trackedSale}`);
  check('E12 a sale naming known serials warns of nothing; one without serials (POS 1.6.0) adds no statement', notCapturedSale === untracked && show(afterSale[0].warnings ?? null) === 'null');
  check('E12 the sold serial left stock and its sale is logged -1', (await serialsOf(world, variant)).S1 === 'sold');

  const unknown = await sellLots(world, variant, 1, { serials: ['GHOST'] });
  check('E12 a serial the system never saw is accepted as sold with SERIAL_NOT_IN_STOCK', show(unknown[0].warnings) === '["SERIAL_NOT_IN_STOCK"]' && (await serialsOf(world, variant)).GHOST === 'sold');
  const uncaptured = await sellLots(world, variant, 1);
  check('E12 a sale without serials is accepted with SERIAL_NOT_CAPTURED', show(uncaptured[0].warnings) === '["SERIAL_NOT_CAPTURED"]');
  // on hand: 3 -1(S1) -1(no serial) -1(GHOST) -1(no serial) = -1 -> serial units without a known serial: 2 in stock (S2,S3) vs -1
  const stock = await stockOf(world, variant);
  check('E12 the sales moved on hand although serials were missing', stock.qty_on_hand.equals(-1), `on hand ${stock.qty_on_hand}`);

  // Customer return: the serial sold on the line comes back.
  await apply((tx) => inventory.apply(tx, command(world, { type: 'return', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: 1, lots: { serials: ['S1'] } }] })));
  check('E12 a returned serial is back in stock', (await serialsOf(world, variant)).S1 === 'in_stock');
  const stillInStock = await rejection(apply((tx) => inventory.apply(tx, command(world, { type: 'return', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: 1, lots: { serials: ['S2'] } }] }))));
  check('E12 a serial that never left cannot be "returned"', codeOf(stillInStock) === 'TRACKING_SERIAL_ALREADY_IN_STOCK');

  // Supplier return: strict. Two more units come in so there is stock to return.
  await receiveLots(world, variant, { serials: ['S5', 'S6'] }, 2);
  const noSerials = await rejection(apply((tx) => inventory.apply(tx, command(world, { type: 'reversal', lines: [{ variantId: variant.id, qtyDelta: -1 }] }))));
  check('E12 a supplier return without serials is refused', codeOf(noSerials) === 'TRACKING_SERIALS_REQUIRED');
  const notHere = await rejection(apply((tx) => inventory.apply(tx, command(world, { type: 'reversal', lines: [{ variantId: variant.id, qtyDelta: -1, lots: { serials: ['GHOST'] } }] }))));
  check('E12 a supplier return of a serial that is not in stock is refused', codeOf(notHere) === 'TRACKING_SERIAL_NOT_IN_STOCK');
  await apply((tx) => inventory.apply(tx, command(world, { type: 'reversal', allowNegative: false, lines: [{ variantId: variant.id, qtyDelta: -1, lots: { serials: ['S5'] } }] })));
  check('E12 a supplier return sends the serial back to the supplier', (await serialsOf(world, variant)).S5 === 'returned_to_supplier');

  // Replay of a tracked command changes nothing.
  const replayCmd = command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: -1, lots: { serials: ['S3'] } }] });
  await apply((tx) => inventory.apply(tx, replayCmd));
  const lotsBefore = await lotsOf(world, variant);
  const [, replayStatements] = await counted(() => apply((tx) => inventory.apply(tx, replayCmd)));
  check('E12 replaying a tracked command applies no lot change (and issues no lot statement)',
    show(await lotsOf(world, variant)) === show(lotsBefore) && replayStatements <= 3, `statements ${replayStatements}`);

  // DB-level guards.
  const tamper = await rejection(prisma.$executeRaw`UPDATE "InventoryLotMovement" SET "qty_delta" = 1 WHERE "tenant_id" = ${world.tenant.id}::uuid`);
  check('E12 the lot ledger is append-only', tamper !== null);
  const negativeBatch = await rejection(prisma.inventoryBatch.create({ data: { tenant_id: world.tenant.id, warehouse_id: world.warehouse.id, variant_id: variant.id, batch_no: 'NEG', qty: -1 } }));
  const negativeUnallocated = await rejection(prisma.inventoryBatch.create({ data: { tenant_id: world.tenant.id, warehouse_id: world.warehouse.id, variant_id: variant.id, batch_no: '', qty: -1 } }));
  check('E12 only the unallocated batch row may be negative', negativeBatch !== null && negativeUnallocated === null);
  const bothLots = await rejection(prisma.$executeRaw`INSERT INTO "InventoryLotMovement" ("tenant_id", "movement_id", "qty_delta") SELECT "tenant_id", "id", 1 FROM "InventoryMovement" WHERE "tenant_id" = ${world.tenant.id}::uuid LIMIT 1`);
  check('E12 a lot movement must name a batch or a serial', bothLots !== null);
}

async function verifyBatchTracking() {
  const world = await createTenantWorld('e13');
  const variant = await createVariant(world, { tracking: 'batch' });

  await receiveLots(world, variant, { batches: [
    { batchNo: 'LATE', expiryDate: '2027-01-01', qty: 5 },
    { batchNo: 'SOON', expiryDate: '2026-06-01', qty: 5 },
    { batchNo: 'NOEXP', qty: 5 },
  ] }, 15);
  const rows = await prisma.inventoryBatch.findMany({ where: { tenant_id: world.tenant.id, variant_id: variant.id } });
  check('E13 receiving creates batches with their expiry dates', rows.length === 3 && day(rows.find((row) => row.batch_no === 'SOON')) === '2026-06-01' && day(rows.find((row) => row.batch_no === 'NOEXP')) === null);

  const plain = await createVariant(world);
  await apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: [{ variantId: plain.id, qtyDelta: 5 }] })));
  const [, untracked] = await counted(() => sellLots(world, plain, 1));
  const [afterFefo, fefoStatements] = await counted(() => sellLots(world, variant, 8));
  check('E13 FEFO takes the soonest expiry first (SOON 5, then LATE 3)', show(await batchesOf(world, variant)) === show({ LATE: 2, NOEXP: 5, SOON: 0 }), show(await batchesOf(world, variant)));
  check('E13 a batch sale adds two statements to the 3 of an untracked one', fefoStatements === 5 && afterFefo[0].warnings === undefined, `got ${fefoStatements} (untracked sale probe counted ${untracked})`);
  check('E13 the sale logged one lot movement per batch drawn (-5, -3)', show(await lotsOf(world, variant)) === show({ total: 15 - 8, rows: 3 + 2 }));

  await sellLots(world, variant, 2, { batches: [{ batchNo: 'NOEXP', qty: 2 }] });
  check('E13 a named batch is honoured', show(await batchesOf(world, variant)) === show({ LATE: 2, NOEXP: 3, SOON: 0 }));

  const untouched = await stockOf(world, variant);
  const sums = (await prisma.inventoryBatch.aggregate({ where: { tenant_id: world.tenant.id, variant_id: variant.id }, _sum: { qty: true } }))._sum.qty;
  check('E13 the batches always add up to on hand', untouched.qty_on_hand.equals(sums), `${untouched.qty_on_hand} vs ${sums}`);

  // Supplier return of a batch: strict.
  const wrongBatch = await rejection(apply((tx) => inventory.apply(tx, command(world, { type: 'reversal', lines: [{ variantId: variant.id, qtyDelta: -3, lots: { batches: [{ batchNo: 'LATE', qty: 3 }] } }] }))));
  check('E13 a supplier return of more than the batch holds is refused', codeOf(wrongBatch) === 'TRACKING_BATCH_INSUFFICIENT');
  const noBatch = await rejection(apply((tx) => inventory.apply(tx, command(world, { type: 'reversal', lines: [{ variantId: variant.id, qtyDelta: -1 }] }))));
  check('E13 a supplier return without a batch is refused', codeOf(noBatch) === 'TRACKING_BATCHES_REQUIRED');
  await apply((tx) => inventory.apply(tx, command(world, { type: 'reversal', lines: [{ variantId: variant.id, qtyDelta: -1, lots: { batches: [{ batchNo: 'LATE', qty: 1 }] } }] })));
  check('E13 a supplier return takes exactly the named batch', (await batchesOf(world, variant)).LATE === 1);

  const report = await inventory.reconcile(world.context);
  check('E13 reconciliation is clean for a batch variant', report.is_consistent === true && report.needs_settlement.length === 0, show(report));
}

async function verifyUnallocatedBatches() {
  const world = await createTenantWorld('e14');
  const variant = await createVariant(world, { tracking: 'batch' });

  const [short] = await sellLots(world, variant, 3);
  check('E14 a sale with no batch to draw on is accepted, charged to the unallocated row, with BATCH_UNALLOCATED',
    show(short.warnings) === '["BATCH_UNALLOCATED"]' && show(await batchesOf(world, variant)) === show({ '(unallocated)': -3 }) && short.qtyAfter.equals(-3));
  const report = await inventory.reconcile(world.context);
  check('E14 the deficit shows as "needs settlement", not as corruption',
    report.is_consistent === true && report.needs_settlement.some((row) => row.kind === 'batch_unallocated' && row.quantity === -3), show(report.needs_settlement));

  await receiveLots(world, variant, { batches: [{ batchNo: 'N1', expiryDate: '2027-05-05', qty: 10 }] }, 10);
  check('E14 the next receipt settles the deficit first (shelf 7, unallocated back to 0)', show(await batchesOf(world, variant)) === show({ '(unallocated)': 0, N1: 7 }), show(await batchesOf(world, variant)));
  check('E14 on hand equals the batches after settlement', (await stockOf(world, variant)).qty_on_hand.equals(7));
  check('E14 the receipt lot movements add up to the units received (7 + 3)', show(await lotsOf(world, variant)) === show({ total: 7, rows: 3 }), show(await lotsOf(world, variant)));
  const settled = await inventory.reconcile(world.context);
  check('E14 nothing is left to settle', settled.needs_settlement.length === 0 && settled.is_consistent === true, show(settled));

  // A sale part-covered by a batch: the rest goes to the unallocated row.
  const [partial] = await sellLots(world, variant, 9);
  check('E14 a sale beyond the batches draws them empty and charges the rest', show(await batchesOf(world, variant)) === show({ '(unallocated)': -2, N1: 0 }) && show(partial.warnings) === '["BATCH_UNALLOCATED"]');

  // Tampering with a batch is corruption.
  await prisma.$executeRaw`UPDATE "InventoryBatch" SET "qty" = "qty" + 1 WHERE "tenant_id" = ${world.tenant.id}::uuid AND "batch_no" = 'N1'`;
  const tampered = await inventory.reconcile(world.context);
  check('E14 batches that no longer add up to on hand are reported as a mismatch', tampered.is_consistent === false && tampered.tracking_mismatches.some((row) => row.kind === 'batch_total' && row.difference === 1), show(tampered.tracking_mismatches));
}

async function verifySerialReconciliation() {
  const world = await createTenantWorld('e15');
  const variant = await createVariant(world, { tracking: 'serial' });
  await receiveLots(world, variant, { serials: ['A', 'B', 'C'] }, 3);
  await sellLots(world, variant, 1); // sold without a serial: on hand 2, in-stock serials 3

  let report = await inventory.reconcile(world.context);
  check('E15 a sale without a serial is "needs settlement" (1 unit), not corruption',
    report.is_consistent === true && report.needs_settlement.some((row) => row.kind === 'serial_uncaptured_sales' && row.quantity === 1), show(report));

  await prisma.$executeRaw`UPDATE "InventorySerial" SET "status" = 'sold', "warehouse_id" = NULL WHERE "tenant_id" = ${world.tenant.id}::uuid AND "serial" IN ('A', 'B', 'C')`;
  report = await inventory.reconcile(world.context);
  check('E15 fewer in-stock serials than on hand is corruption', report.is_consistent === false && report.tracking_mismatches.some((row) => row.kind === 'serial_count' && row.difference === -2), show(report.tracking_mismatches));
}

async function verifyTrackingReplayAndConcurrency() {
  const world = await createTenantWorld('e16');
  const variant = await createVariant(world, { tracking: 'batch' });
  await receiveLots(world, variant, { batches: [{ batchNo: 'A', expiryDate: '2026-12-01', qty: 10 }, { batchNo: 'B', expiryDate: '2027-12-01', qty: 10 }] }, 20);

  const cmd = command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: -4 }] });
  await apply((tx) => inventory.apply(tx, cmd));
  await apply((tx) => inventory.apply(tx, cmd));
  check('E16 replaying a batch command draws the batch once', show(await batchesOf(world, variant)) === show({ A: 6, B: 10 }), show(await batchesOf(world, variant)));

  // Two concurrent sales of the same batch variant: serialized by the stock row, no deadlock, consistent.
  const held = apply(async (tx) => { await inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: -5 }] })); await sleep(400); });
  await sleep(100);
  const waiting = apply((tx) => inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: variant.id, qtyDelta: -5 }] })));
  const settled = await Promise.allSettled([held, waiting]);
  const sums = (await prisma.inventoryBatch.aggregate({ where: { tenant_id: world.tenant.id, variant_id: variant.id }, _sum: { qty: true } }))._sum.qty;
  check('E16 two concurrent sales of one batch variant both succeed (no deadlock)', settled.every((r) => r.status === 'fulfilled'), settled.map((r) => r.reason?.message).filter(Boolean).join('; '));
  check('E16 ...and end consistent: batches drawn oldest first and adding up to on hand', show(await batchesOf(world, variant)) === show({ A: 0, B: 6 }) && (await stockOf(world, variant)).qty_on_hand.equals(sums), show(await batchesOf(world, variant)));

  // Concurrent shortfalls both charge the unallocated row (one row, upserted by two commands in turn).
  const short = createVariant(world, { tracking: 'batch' }).then(async (other) => {
    await receiveLots(world, other, { batches: [{ batchNo: 'ONLY', qty: 5 }] }, 5);
    const results = await Promise.allSettled([sellLots(world, other, 8), sellLots(world, other, 8)]);
    const rows = await batchesOf(world, other);
    return { results, rows, on_hand: (await stockOf(world, other)).qty_on_hand };
  });
  const { results, rows, on_hand } = await short;
  check('E16 concurrent shortfalls both land on the unallocated row without conflict', results.every((r) => r.status === 'fulfilled') && show(rows) === show({ '(unallocated)': -11, ONLY: 0 }) && on_hand.equals(-11), show({ rows, on_hand: String(on_hand), errors: results.map((r) => r.reason?.message) }));

  // Opposite variant orders over tracked variants do not deadlock either.
  const [x, y] = await createVariants(world, 2, { tracking: 'batch' });
  await Promise.all([x, y].map((v) => receiveLots(world, v, { batches: [{ batchNo: 'K', qty: 10 }] }, 10)));
  const orderResults = await Promise.allSettled([
    apply(async (tx) => { await inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: x.id, qtyDelta: -1 }, { variantId: y.id, qtyDelta: -1 }] })); await sleep(200); }),
    apply(async (tx) => { await inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: y.id, qtyDelta: -1 }, { variantId: x.id, qtyDelta: -1 }] })); await sleep(200); }),
  ]);
  check('E16 opposite line orders over tracked variants do not deadlock', orderResults.every((r) => r.status === 'fulfilled'), orderResults.map((r) => r.reason?.message).filter(Boolean).join('; '));

  const report = await inventory.reconcile(world.context);
  check('E16 reconciliation is clean after all of it (unallocated aside)', report.tracking_mismatches.length === 0 && report.items.length === 0, show(report.tracking_mismatches));
}

// --- E17: enabling tracking (docs/design/W2b-tracking.md section 2) ---------------

async function verifyEnablingTracking() {
  const world = await createTenantWorld('e17');
  const run = randomUUID().slice(0, 8);
  const plan = await prisma.plan.create({
    data: { code: `e17-${run}`, name_ar: 'خطة', name_en: 'E17', price_monthly: 1, limits: {}, features: ['tracking.serial'] },
  });
  await prisma.subscription.create({ data: { tenant_id: world.tenant.id, plan_id: plan.id, status: 'active' } });
  const entitlements = new EntitlementService(prisma);
  const products = new ProductsService(
    new ProductsRepository(prisma), new BrandsRepository(prisma), new TaxCodeService(new TaxCodeRepository(prisma)),
    new LimitService(prisma, entitlements), new ProductTypesService(prisma), entitlements,
  );
  const updateTracking = (variant, tracking, extra = {}) => products.updateVariant(world.context, variant.id, { tracking, ...extra });
  const trackingOf = async (variant) => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).tracking;
  const syncChanges = (variant) => prisma.syncChange.count({ where: { tenant_id: world.tenant.id, kind: 'variant', entity_key: variant.id } });

  const variant = await createVariant(world);
  const before = await syncChanges(variant);
  await updateTracking(variant, 'serial');
  check('E17 tracking turns on for a variant with no stock when the plan has the feature', (await trackingOf(variant)) === 'serial');
  check('E17 changing tracking emits the usual variant sync change', (await syncChanges(variant)) > before);

  const noBatch = await rejection(updateTracking(await createVariant(world), 'batch'));
  check('E17 batch tracking is refused when the plan lacks tracking.batch', noBatch?.code === 'ENTITLEMENT_FEATURE_NOT_IN_PLAN', noBatch?.message);

  const kg = await prisma.unitOfMeasure.create({ data: { tenant_id: world.tenant.id, code: 'KG', name_en: 'Kilogram', precision: 3 } });
  const kgVariant = await createVariant(world, { base_uom_id: kg.id });
  const fractional = await rejection(updateTracking(kgVariant, 'serial'));
  check('E17 serial tracking needs a unit with precision 0', fractional?.code === 'REQUEST_FIELD_VALUE_INVALID' && (await trackingOf(kgVariant)) === 'none', fractional?.message);

  const stocked = await createVariant(world);
  await apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: [{ variantId: stocked.id, qtyDelta: 2 }] })));
  const withStock = await rejection(updateTracking(stocked, 'serial'));
  check('E17 tracking cannot change while a warehouse holds stock', withStock?.response?.code === 'CATALOG_TRACKING_CHANGE_RESTRICTED' && (await trackingOf(stocked)) === 'none', withStock?.message);
  await apply((tx) => inventory.apply(tx, command(world, { type: 'sale', allowNegative: true, lines: [{ variantId: stocked.id, qtyDelta: -2 }] })));
  await updateTracking(stocked, 'serial');
  check('E17 ...but can once the stock is back to zero', (await trackingOf(stocked)) === 'serial');

  // Units on the road count: their receipt would arrive untracked.
  const otherBranch = await world.branches.save(world.context, { code: `E17B-${run}`, name_ar: 'فرع' });
  const shipped = await createVariant(world);
  await apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: [{ variantId: shipped.id, qtyDelta: 1 }] })));
  const transfers = new TransfersService(prisma, inventory);
  const created = await transfers.create(world.context, { from_branch_id: world.branch.id, to_branch_id: otherBranch.id, command_id: randomUUID(), items: [{ variant_id: shipped.id, qty: 1 }] }, ownerActor(world));
  await transfers.ship(world.context, created.id, { command_id: randomUUID() }, ownerActor(world));
  const onTheRoad = await rejection(updateTracking(shipped, 'serial'));
  check('E17 tracking cannot change while a transfer still has units in transit', onTheRoad?.response?.code === 'CATALOG_TRACKING_CHANGE_RESTRICTED', onTheRoad?.message);

  // A plan downgrade never traps a tracked variant: turning tracking off and edits stay possible.
  await prisma.plan.update({ where: { id: plan.id }, data: { features: [] } });
  entitlements.invalidate();
  await products.updateVariant(world.context, variant.id, { sku: `RENAMED-${run}` });
  await updateTracking(variant, 'none');
  check('E17 after a downgrade an existing tracked variant can still be edited and switched off', (await trackingOf(variant)) === 'none');
}

// --- E18: tracked documents (purchase, sale, customer return, supplier return) ---

async function verifyTrackedDocuments() {
  const world = await createTenantWorld('e18');
  await prisma.taxCode.create({
    data: {
      tenant_id: world.tenant.id, tax_category_id: world.taxCategory.id, code: 'STANDARD', name_en: 'Standard rate',
      jurisdiction: 'EG', calculation_method: 'percentage', rate: D('14.0000'), tax_mode: 'exclusive', rounding_policy: 'line',
      version: 1, status: 'active', activated_at: new Date(), updated_at: new Date(),
    },
  });
  const book = await prisma.priceBook.create({ data: { tenant_id: world.tenant.id, name: 'Tracked book', currency: 'EGP', status: 'active', is_default: true } });
  await prisma.priceBookEntry.create({
    data: { tenant_id: world.tenant.id, price_book_id: book.id, scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 100, allow_zero_price: false, tax_mode: 'exclusive', effective_from: new Date(0), status: 'active' },
  });
  const terminal = await prisma.posTerminal.create({
    data: { tenant_id: world.tenant.id, device_id: randomUUID(), terminal_code: `T-${randomUUID().slice(0, 6)}`, name: 'Till', branch_id: world.branch.id },
  });
  const staff = async (role, name) => {
    const user = await prisma.user.create({ data: { name, password_hash: 'not-a-real-hash' } });
    await prisma.membership.create({
      data: { tenant_id: world.tenant.id, user_id: user.id, role, status: 'active', access_scope_assignments: { create: { scope_type: 'location', scope_ref_id: world.branch.id, grant_source: 'verify' } } },
    });
    return user;
  };
  const cashier = await staff('cashier', 'Cashier');
  const seller = await staff('seller', 'Seller');
  const shift = await prisma.shift.create({ data: { tenant_id: world.tenant.id, branch_id: world.branch.id, opened_by: cashier.id } });
  const sales = new SalesService(prisma, new PricingService(prisma, new TaxResolutionService(prisma)), { canViewSaleCostMargin: async () => false }, new SalesTaxSnapshotService(), inventory);
  const purchasing = new PurchasingService(prisma, inventory);
  const actor = ownerActor(world);
  const terminalRow = { id: terminal.id, branch_id: world.branch.id, tenant_id: world.tenant.id };

  let sequence = 0;
  /** A POS 1.6.0-shaped sale (no serials / batch_no anywhere) unless `lots` say otherwise. */
  const saleOf = (variant, qty = 1, lots = {}) => {
    sequence += 1;
    return {
      event_version: 2, sync_id: randomUUID(), branch_id: world.branch.id, shift_id: shift.id, origin_cashier_id: cashier.id,
      cashier_name_snapshot: 'Cashier', seller_id: seller.id, seller_name_snapshot: 'Seller', offline_session_id: randomUUID(),
      terminal_sequence: String(sequence), occurred_at: new Date().toISOString(), payment_method: 'cash', language: 'ar',
      items: [{ variant_id: variant.id, qty, unit_price: 100, unit_tax: 14, sku_snapshot: variant.sku, name_ar_snapshot: 'صنف', name_en_snapshot: 'Item', ...lots }],
      local_total: Number(D(qty).mul(114).toFixed(2)),
    };
  };
  const sell = (variant, qty, lots) => sales.createSale(saleOf(variant, qty, lots), terminalRow);
  const receive = (items, extra = {}) =>
    purchasing.receive(world.context, { command_id: randomUUID(), supplier_id: world.supplier.id, branch_id: world.branch.id, items, ...extra }, actor);

  const plain = await createVariant(world);
  const phone = await createVariant(world, { tracking: 'serial' });
  const milk = await createVariant(world, { tracking: 'batch' });
  await apply((tx) => inventory.apply(tx, command(world, { type: 'opening_balance', lines: [{ variantId: plain.id, qtyDelta: 20 }] })));

  // --- purchase receive
  const invoicesBefore = await prisma.purchaseInvoice.count({ where: { tenant_id: world.tenant.id } });
  const noSerials = await rejection(receive([{ variant_id: phone.id, qty: 2, unit_cost: 50 }]));
  check('E18 receiving a serial item without serials is refused', codeOf(noSerials) === 'TRACKING_SERIALS_REQUIRED', noSerials?.message);
  const purchase = await receive([{ variant_id: phone.id, qty: 3, unit_cost: 50, serials: ['P1', 'P2', 'P3'] }]);
  check('E18 receiving serials puts them in stock', (await stockOf(world, phone)).qty_on_hand.equals(3) && show(await serialsOf(world, phone)) === show({ P1: 'in_stock', P2: 'in_stock', P3: 'in_stock' }));
  const duplicate = await rejection(receive([{ variant_id: phone.id, qty: 2, unit_cost: 50, serials: ['P3', 'P4'] }]));
  check('E18 a duplicate serial is refused and no purchase invoice is left behind',
    codeOf(duplicate) === 'TRACKING_SERIAL_ALREADY_IN_STOCK' && (await prisma.purchaseInvoice.count({ where: { tenant_id: world.tenant.id } })) === invoicesBefore + 1 && !('P4' in (await serialsOf(world, phone))), duplicate?.message);
  const expiryOnly = await rejection(receive([{ variant_id: milk.id, qty: 2, unit_cost: 5, expiry_date: '2027-01-01' }]));
  check('E18 an expiry date without a batch is refused', expiryOnly?.status === 400);
  await receive([
    { variant_id: milk.id, qty: 6, unit_cost: 5, batch_no: 'M-LATE', expiry_date: '2027-03-01' },
    { variant_id: milk.id, qty: 4, unit_cost: 5, batch_no: 'M-SOON', expiry_date: '2026-11-01' },
  ]);
  check('E18 a variant received in two batches keeps both with their expiry',
    show(await batchesOf(world, milk)) === show({ 'M-LATE': 6, 'M-SOON': 4 }) && day(await prisma.inventoryBatch.findFirst({ where: { tenant_id: world.tenant.id, batch_no: 'M-SOON' } })) === '2026-11-01');
  const untrackedWithSerials = await rejection(receive([{ variant_id: plain.id, qty: 2, unit_cost: 5, serials: ['X', 'Y'] }]));
  check('E18 serials for an untracked item are refused, not ignored', codeOf(untrackedWithSerials) === 'TRACKING_DATA_NOT_EXPECTED');
  const reversal = await rejection(purchasing.reverse(world.context, purchase.id, { reason: 'wrong' }, actor));
  check('E18 a receipt of tracked items cannot be reversed (return the goods instead)', codeOf(reversal) === 'TRACKED_PURCHASE_REVERSAL_NOT_SUPPORTED');

  // --- sale: a POS 1.6.0 payload (no serials) must always be accepted
  await sell(plain); // warm caches
  const [, untrackedSale] = await counted(() => sell(plain));
  const oldPosDto = saleOf(phone);
  const [oldPosSale, oldPosStatements] = await counted(() => sales.createSale(oldPosDto, terminalRow));
  check('E18 a POS 1.6.0 sale (no serials) of a serial item succeeds with SERIAL_NOT_CAPTURED', oldPosSale.warning_codes.includes('SERIAL_NOT_CAPTURED') && (await stockOf(world, phone)).qty_on_hand.equals(2));
  check('E18 ...and costs no more statements than an untracked sale', oldPosStatements === untrackedSale, `tracked ${oldPosStatements} vs untracked ${untrackedSale}`);
  const replayed = await sales.createSale(oldPosDto, terminalRow);
  check('E18 replaying that 1.6.0 sale returns the same invoice (its fingerprint is unchanged)', replayed.id === oldPosSale.id && (await stockOf(world, phone)).qty_on_hand.equals(2));

  const [serialSale, serialStatements] = await counted(() => sales.createSale(saleOf(phone, 1, { serials: ['P1'] }), terminalRow));
  check('E18 a sale naming a known serial marks it sold, without a warning', (await serialsOf(world, phone)).P1 === 'sold' && !serialSale.warning_codes.some((code) => code.startsWith('SERIAL_')));
  check('E18 a serial sale adds two statements to an untracked sale', serialStatements === untrackedSale + 2, `got ${serialStatements}, untracked ${untrackedSale}`);
  const ghost = await sell(phone, 1, { serials: ['NOT-IN-STOCK'] });
  check('E18 an unknown serial is accepted as sold with SERIAL_NOT_IN_STOCK', ghost.warning_codes.includes('SERIAL_NOT_IN_STOCK') && (await serialsOf(world, phone))['NOT-IN-STOCK'] === 'sold');

  const [batchSale, batchStatements] = await counted(() => sell(milk, 7));
  check('E18 a batch sale draws FEFO (M-SOON 4, then M-LATE 3) in two extra statements',
    show(await batchesOf(world, milk)) === show({ 'M-LATE': 3, 'M-SOON': 0 }) && batchStatements === untrackedSale + 2 && !batchSale.warning_codes.includes('BATCH_UNALLOCATED'), show(await batchesOf(world, milk)));
  const beyond = await sell(milk, 5);
  check('E18 a sale beyond the batches is accepted with BATCH_UNALLOCATED and shows as needing settlement',
    beyond.warning_codes.includes('BATCH_UNALLOCATED') && show(await batchesOf(world, milk)) === show({ '(unallocated)': -2, 'M-LATE': 0, 'M-SOON': 0 }));

  const settling = await inventory.reconcile(world.context);
  check('E18 the deficit and the units without a scanned serial are listed as needing settlement, not as corruption',
    settling.items.length === 0 && settling.tracking_mismatches.length === 0
      && settling.needs_settlement.some((row) => row.kind === 'batch_unallocated' && row.quantity === -2)
      && settling.needs_settlement.some((row) => row.kind === 'serial_uncaptured_sales'), show(settling.needs_settlement));

  // --- customer return
  const serialItem = serialSale.items[0].id;
  const wrongSerial = await rejection(sales.createReturn(world.context, { original_invoice_id: serialSale.id, items: [{ sales_invoice_item_id: serialItem, qty: 1, serials: ['P2'] }] }, actor));
  check('E18 a return names only serials that were sold on that line', codeOf(wrongSerial) === 'RETURN_SERIAL_NOT_SOLD_ON_LINE', wrongSerial?.message);
  const missingSerial = await rejection(sales.createReturn(world.context, { original_invoice_id: serialSale.id, items: [{ sales_invoice_item_id: serialItem, qty: 1 }] }, actor));
  check('E18 a return of a serial item without its serial is refused', codeOf(missingSerial) === 'TRACKING_SERIALS_REQUIRED');
  await sales.createReturn(world.context, { original_invoice_id: serialSale.id, items: [{ sales_invoice_item_id: serialItem, qty: 1, serials: ['P1'] }] }, actor);
  check('E18 a returned serial is back in stock', (await serialsOf(world, phone)).P1 === 'in_stock');
  const twice = await rejection(sales.createReturn(world.context, { original_invoice_id: serialSale.id, items: [{ sales_invoice_item_id: serialItem, qty: 1, serials: ['P1'] }] }, actor));
  check('E18 the same unit cannot be returned twice', twice !== null);
  // The 1.6.0 sale sold a unit with no serial on record: its return may name the unit's serial.
  const alreadyThere = await rejection(sales.createReturn(world.context, { original_invoice_id: oldPosSale.id, items: [{ sales_invoice_item_id: oldPosSale.items[0].id, qty: 1, serials: ['P2'] }] }, actor));
  check('E18 ...but a serial that is in stock cannot come back as a return', codeOf(alreadyThere) === 'TRACKING_SERIAL_ALREADY_IN_STOCK', alreadyThere?.message);
  await sales.createReturn(world.context, { original_invoice_id: oldPosSale.id, items: [{ sales_invoice_item_id: oldPosSale.items[0].id, qty: 1, serials: ['UNSCANNED-1'] }] }, actor);
  check('E18 a unit sold by a POS without serial scanning can be returned with its own serial', (await serialsOf(world, phone))['UNSCANNED-1'] === 'in_stock');

  // Batch return goes back to the batches the sale line drew. A receipt first settles the deficit.
  await receive([{ variant_id: milk.id, qty: 5, unit_cost: 5, batch_no: 'M-LATE' }]);
  check('E18 the next receipt settles the unallocated deficit before shelving the rest', show(await batchesOf(world, milk)) === show({ '(unallocated)': 0, 'M-LATE': 3, 'M-SOON': 0 }), show(await batchesOf(world, milk)));
  const milkSale = await sell(milk, 1, { batch_no: 'M-LATE' });
  const beforeReturn = await batchesOf(world, milk);
  await sales.createReturn(world.context, { original_invoice_id: milkSale.id, items: [{ sales_invoice_item_id: milkSale.items[0].id, qty: 1 }] }, actor);
  const afterReturn = await batchesOf(world, milk);
  check('E18 a batch return goes back to the batch the line drew', beforeReturn['M-LATE'] === 2 && afterReturn['M-LATE'] === beforeReturn['M-LATE'] + 1 && afterReturn['(unallocated)'] === beforeReturn['(unallocated)'], show({ beforeReturn, afterReturn }));

  // --- supplier return (strict)
  const item = (await purchasing.get(world.context, purchase.id)).items[0];
  const giveBack = (extra) => purchasing.returnToSupplier(world.context, purchase.id, { command_id: randomUUID(), reason: 'Faulty', items: [{ purchase_invoice_item_id: item.id, qty: 1, ...extra }] }, actor);
  const noneNamed = await rejection(giveBack({}));
  check('E18 a supplier return of a serial item without its serial is refused', codeOf(noneNamed) === 'TRACKING_SERIALS_REQUIRED');
  const notThere = await rejection(giveBack({ serials: ['P1-NOT-HERE'] }));
  check('E18 ...and one naming a serial that is not in stock is refused', codeOf(notThere) === 'TRACKING_SERIAL_NOT_IN_STOCK');
  await giveBack({ serials: ['P3'] });
  check('E18 a supplier return sends the serial back to the supplier', (await serialsOf(world, phone)).P3 === 'returned_to_supplier');

  // --- transfers stay closed for tracked items until W2b-2
  const otherBranch = await world.branches.save(world.context, { code: `E18B-${randomUUID().slice(0, 6)}`, name_ar: 'فرع آخر' });
  const transfers = new TransfersService(prisma, inventory);
  const transfer = await rejection(transfers.create(world.context, { from_branch_id: world.branch.id, to_branch_id: otherBranch.id, command_id: randomUUID(), items: [{ variant_id: phone.id, qty: 1 }] }, actor));
  check('E18 a transfer of a tracked item is refused with a clear error', codeOf(transfer) === 'TRACKED_TRANSFER_NOT_SUPPORTED', transfer?.message);

  const report = await inventory.reconcile(world.context);
  check('E18 nothing corrupt after all of it', report.items.length === 0 && report.tracking_mismatches.length === 0, show({ items: report.items, tracking: report.tracking_mismatches }));
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
  await verifySerialTracking();
  await verifyBatchTracking();
  await verifyUnallocatedBatches();
  await verifySerialReconciliation();
  await verifyTrackingReplayAndConcurrency();
  await verifyEnablingTracking();
  await verifyTrackedDocuments();

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll inventory engine checks passed\n');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
