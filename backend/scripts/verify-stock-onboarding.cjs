#!/usr/bin/env node
// Real-Postgres proof of L1 (store onboarding): opening balance, stock
// adjustments, stock counts, the bulk product import and the stock lists.
// Constructs the real compiled services against a real PrismaClient, so it
// asserts on the code that ships and requires `npm run build` first (see
// `npm run test:db`).
//
//   O1-O8   opening balance: cost, idempotent replay, refusal after a movement,
//           key reuse, concurrent requests, constant statements, tracked refusal
//   A1-A7   adjustments: state machine, permissions-by-step, mixed-sign posting,
//           immutability (app and database), negative stock, cost valuation
//   C1-C8   stock counts: per-item expected at count time, sales before and
//           after counting, idempotent scans, scope, single active count,
//           uncounted choice, posting
//   I1-I8   import: dry run vs real run, skip existing, product limit,
//           batch statement counts, prices, opening quantities, categories
//   L1-L3   items at or below zero / without a stock row
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const dist = (...segments) => path.join(__dirname, '..', 'dist', 'src', ...segments);

const load = (folder, file, name) => {
  try {
    return require(dist(folder, file))[name];
  } catch (error) {
    console.error(
      `Could not load ${folder}/${file} from dist/. This script asserts on the shipped code, so it requires ` +
        `\`npm run build\` first. Original error: ${error?.message ?? error}`,
    );
    process.exit(1);
  }
};

const InventoryService = load('inventory', 'inventory.service.js', 'InventoryService');
const InventoryRepository = load('inventory', 'inventory.repository.js', 'InventoryRepository');
const BranchesRepository = load('branches', 'branches.repository.js', 'BranchesRepository');
const OpeningBalanceService = load('opening-balance', 'opening-balance.service.js', 'OpeningBalanceService');

const AdjustmentsService = load('adjustments', 'adjustments.service.js', 'AdjustmentsService');
const AdjustmentsReadService = load('adjustments', 'adjustments.read.service.js', 'AdjustmentsReadService');

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const inventory = new InventoryService(new InventoryRepository(prisma));
const openingBalance = new OpeningBalanceService(prisma, inventory);
const adjustmentReads = new AdjustmentsReadService(prisma);
const adjustments = new AdjustmentsService(prisma, inventory, adjustmentReads);
const StockCountsService = load('stock-counts', 'stock-counts.service.js', 'StockCountsService');
const StockCountScansService = load('stock-counts', 'stock-count-scans.service.js', 'StockCountScansService');
const StockCountsReadService = load('stock-counts', 'stock-counts.read.service.js', 'StockCountsReadService');
const countReads = new StockCountsReadService(prisma);
const counts = new StockCountsService(prisma, inventory, countReads);
const countScans = new StockCountScansService(prisma);
const LowStockService = load('inventory', 'low-stock.service.js', 'LowStockService');
const lowStock = new LowStockService(prisma);

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`);
}

// --- statement counting -------------------------------------------------------

let capture = null;
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
    capture = null;
  }
}

const D = (value) => new Prisma.Decimal(value);

async function rejection(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}
const codeOf = (error) => error?.response?.code ?? error?.code ?? null;

// --- fixtures -----------------------------------------------------------------

async function createTenantWorld(label) {
  const tenant = await prisma.tenant.create({ data: { name: `l1-${label}-${randomUUID()}`, default_currency: 'EGP' } });
  const context = { tenantId: tenant.id };
  const branch = await new BranchesRepository(prisma).save(context, { code: `L-${randomUUID().slice(0, 8)}`, name_ar: `فرع ${label}` });
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenant_id: tenant.id, branch_id: branch.id, is_default: true } });
  const taxCategory = await prisma.taxCategory.create({
    data: { tenant_id: tenant.id, code: 'STANDARD', name_en: 'Standard', updated_at: new Date() },
  });
  const user = await prisma.user.create({ data: { name: `L1 actor ${label}`, password_hash: 'not-a-real-hash' } });
  return { tenant, context, branch, warehouse, taxCategory, user };
}

async function createVariant(world, overrides = {}) {
  const product = await prisma.product.create({
    data: { tenant_id: world.tenant.id, name_en: `L1 product ${randomUUID()}`, tax_category_id: world.taxCategory.id, is_active: true, ...(overrides.product ?? {}) },
  });
  const { product: _product, ...variant } = overrides;
  return prisma.productVariant.create({
    data: {
      tenant_id: world.tenant.id,
      product_id: product.id,
      sku: `L1-${randomUUID().slice(0, 8)}`,
      cost_price: D(10),
      is_active: true,
      ...variant,
    },
  });
}

async function createVariants(world, count, overrides = {}) {
  const variants = [];
  for (let i = 0; i < count; i += 1) variants.push(await createVariant(world, overrides));
  return variants;
}

/** A request user. `permissions` are the keys the step under test needs. */
const actorOf = (world, permissions = [], extra = {}) => ({
  sub: world.user.id,
  membership_role: 'tenant_owner',
  permissions: new Set(permissions),
  scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }],
  ...extra,
});

const stockOf = (world, variant) =>
  prisma.inventoryStock.findUnique({ where: { warehouse_id_variant_id: { warehouse_id: world.warehouse.id, variant_id: variant.id } } });

const applyCommand = (world, overrides) =>
  prisma.$transaction((tx) =>
    inventory.apply(tx, {
      tenantId: world.tenant.id,
      warehouseId: world.warehouse.id,
      occurredAt: new Date(),
      actorId: world.user.id,
      type: 'sale',
      reference: { type: 'Verify', id: randomUUID() },
      idempotencyKey: `verify:${randomUUID()}`,
      allowNegative: true,
      ...overrides,
    }),
  );

/** A real sale-shaped stock movement (what the till does), without the invoice around it. */
const sell = (world, variant, qty) =>
  applyCommand(world, { type: 'sale', lines: [{ variantId: variant.id, qtyDelta: -qty }] });

// --- O: opening balance --------------------------------------------------------

async function verifyOpeningBalance() {
  const world = await createTenantWorld('opening');
  const actor = actorOf(world);
  const [a, b, c] = await createVariants(world, 3);
  const open = (lines, key = `key-${randomUUID()}`, branch = world.branch.id) =>
    openingBalance.post(world.context, { branch_id: branch, idempotency_key: key, lines }, actor);

  const key = `opening-${randomUUID()}`;
  const first = await open([{ variant_id: a.id, qty: 10, unit_cost: 25.5 }, { variant_id: b.id, qty: 4 }], key);
  const stockA = await stockOf(world, a);
  const stockB = await stockOf(world, b);
  check('O1 opening posts quantity and unit cost (average = the given cost)', first.posted === 2 && stockA.qty_on_hand.equals(10) && stockA.avg_cost.equals('25.5'));
  check('O1 a line without a cost uses the variant cost', stockB.avg_cost.equals(10));
  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { tenant_id: world.tenant.id, variant_id: a.id } });
  const costMovement = await prisma.inventoryCostMovement.findFirstOrThrow({ where: { tenant_id: world.tenant.id, variant_id: a.id } });
  check('O1 one opening_balance movement and cost movement per line', movement.movement_type === 'opening_balance' && costMovement.movement_type === 'opening_balance' && costMovement.movement_value.equals('255'));
  check('O1 the variant cost mirrors the opening cost', (await prisma.productVariant.findUniqueOrThrow({ where: { id: a.id } })).cost_price.equals('25.5'));

  const replay = await open([{ variant_id: a.id, qty: 10, unit_cost: 25.5 }, { variant_id: b.id, qty: 4 }], key);
  check('O2 replaying the same key returns the same result without posting again', replay.posted === 2 && (await stockOf(world, a)).qty_on_hand.equals(10) && (await prisma.inventoryMovement.count({ where: { tenant_id: world.tenant.id, variant_id: a.id } })) === 1);

  const reuse = await rejection(open([{ variant_id: a.id, qty: 99 }, { variant_id: b.id, qty: 4 }], key));
  check('O4 the same key with a different payload is refused by code', codeOf(reuse) === 'IDEMPOTENCY_KEY_REUSED', show(codeOf(reuse)));

  const again = await rejection(open([{ variant_id: a.id, qty: 5 }]));
  check('O3 a variant that was opened cannot be opened again (422, per-line reason)', codeOf(again) === 'OPENING_BALANCE_REJECTED' && again.response.data.results[0].code === 'OPENING_BALANCE_NOT_ALLOWED');

  await sell(world, c, 1);
  const afterSale = await open([{ variant_id: c.id, qty: 5 }, { variant_id: (await createVariant(world)).id, qty: 2 }]);
  check('O3 a variant with any earlier movement (a sale) is refused while the others post', afterSale.posted === 1 && afterSale.results[0].code === 'OPENING_BALANCE_NOT_ALLOWED' && afterSale.results[1].status === 'posted');
  check('O3 the refused variant was left alone', (await stockOf(world, c)).qty_on_hand.equals(-1));

  // O5 two concurrent requests, different keys, same fresh variant: exactly one wins.
  const raced = await createVariant(world);
  const outcomes = await Promise.all([
    rejection(open([{ variant_id: raced.id, qty: 3 }])).then((error) => error ?? 'posted'),
    rejection(open([{ variant_id: raced.id, qty: 7 }])).then((error) => error ?? 'posted'),
  ]);
  const winners = outcomes.filter((outcome) => outcome === 'posted').length;
  const racedStock = await stockOf(world, raced);
  const racedMovements = await prisma.inventoryMovement.count({ where: { tenant_id: world.tenant.id, variant_id: raced.id } });
  check('O5 concurrent openings of one variant: one request wins, the other is refused', winners === 1 && racedMovements === 1 && (racedStock.qty_on_hand.equals(3) || racedStock.qty_on_hand.equals(7)), `winners=${winners}, movements=${racedMovements}, outcomes=${outcomes.map((o) => (o === 'posted' ? o : codeOf(o))).join(',')}`);

  // O6 statements do not grow with the number of lines.
  const many = await createVariants(world, 41);
  const [, one] = await counted(() => open([{ variant_id: many[0].id, qty: 1 }]));
  const [, forty] = await counted(() => open(many.slice(1).map((variant) => ({ variant_id: variant.id, qty: 2, unit_cost: 3 }))));
  check('O6 opening 1 line and 40 lines use the same number of statements', one === forty, `1 line=${one}, 40 lines=${forty}`);

  // O7 tracked variants are refused for now.
  const serial = await createVariant(world, { tracking: 'serial' });
  const tracked = await rejection(open([{ variant_id: serial.id, qty: 1 }]));
  check('O7 a serial-tracked variant is refused with a clear code', codeOf(tracked) === 'OPENING_BALANCE_REJECTED' && tracked.response.data.results[0].code === 'TRACKED_VARIANT_NOT_SUPPORTED');

  // O8 another tenant's variant and branch are not reachable.
  const other = await createTenantWorld('opening-other');
  const foreignVariant = await createVariant(other);
  const crossVariant = await rejection(open([{ variant_id: foreignVariant.id, qty: 1 }]));
  check('O8 another tenant\'s variant is not found', codeOf(crossVariant) === 'OPENING_BALANCE_REJECTED' && crossVariant.response.data.results[0].code === 'VARIANT_NOT_FOUND');
  const crossBranch = await rejection(open([{ variant_id: a.id, qty: 1 }], `key-${randomUUID()}`, other.branch.id));
  check('O8 another tenant\'s branch is not found', crossBranch?.status === 404 || crossBranch?.getStatus?.() === 404);
}

const show = (value) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));

// --- A: adjustments ------------------------------------------------------------

async function openStock(world, variant, qty, cost = 20) {
  await openingBalance.post(
    world.context,
    { branch_id: world.branch.id, idempotency_key: `open-${randomUUID()}`, lines: [{ variant_id: variant.id, qty, unit_cost: cost }] },
    actorOf(world),
  );
}

async function verifyAdjustments() {
  const world = await createTenantWorld('adjust');
  const cost = ['inventory.position.view-cost'];
  const requester = actorOf(world, ['inventory.adjustment.request', ...cost]);
  const [a, b, c] = await createVariants(world, 3);
  await openStock(world, a, 10, 20);
  await openStock(world, b, 10, 30);
  const draft = (lines, extra = {}) => adjustments.create(world.context, { branch_id: world.branch.id, lines, ...extra }, requester);
  const reason = 'damaged';

  // A1 create + idempotent create
  const commandId = `cmd-${randomUUID()}`;
  const lines = [
    { variant_id: a.id, qty_delta: -2, reason_code: reason },
    { variant_id: b.id, qty_delta: 5, reason_code: 'found' },
  ];
  const doc = await draft(lines, { command_id: commandId });
  check('A1 a draft is created with a number and its lines', doc.status === 'draft' && /^ADJ-\d{6}$/.test(doc.adjustment_number) && doc.items.length === 2);
  const same = await draft(lines, { command_id: commandId });
  const docs = await prisma.stockAdjustment.count({ where: { tenant_id: world.tenant.id } });
  check('A1 the same command id returns the same document', same.id === doc.id && docs === 1);
  const clash = await rejection(draft([{ variant_id: a.id, qty_delta: -9, reason_code: reason }], { command_id: commandId }));
  check('A1 the same command id with another payload is refused', codeOf(clash) === 'IDEMPOTENCY_KEY_REUSED', show(codeOf(clash)));
  check('A1 a draft changes no stock', (await stockOf(world, a)).qty_on_hand.equals(10));

  // A2 state machine
  const early = await rejection(adjustments.post(world.context, doc.id, actorOf(world)));
  check('A2 a draft cannot be posted', codeOf(early) === 'ADJUSTMENT_NOT_APPROVED');
  const edited = await adjustments.update(world.context, doc.id, { note: 'recount', lines: [{ variant_id: a.id, qty_delta: -3, reason_code: reason }, lines[1]] }, requester);
  check('A2 a draft can be edited (lines replaced)', edited.note === 'recount' && edited.items.some((item) => item.qty_delta === -3));
  const approved = await adjustments.approve(world.context, doc.id, actorOf(world));
  check('A2 approval records who and when', approved.status === 'approved' && approved.approved?.id === world.user.id && !!approved.approved.at);
  const approveAgain = await adjustments.approve(world.context, doc.id, actorOf(world));
  check('A2 approving twice is harmless', approveAgain.status === 'approved');
  const lateEdit = await rejection(adjustments.update(world.context, doc.id, { lines }, requester));
  check('A2 an approved document cannot be edited', codeOf(lateEdit) === 'ADJUSTMENT_NOT_DRAFT');

  // A3/A4 posting: one engine command, valued at the average cost
  const [posted, statements] = await counted(() => adjustments.post(world.context, doc.id, actorOf(world, cost)));
  const movements = await prisma.inventoryMovement.findMany({ where: { tenant_id: world.tenant.id, reference_type: 'StockAdjustment', reference_id: doc.id } });
  check('A3 posting is one engine command: one adjustment movement per line, one key', posted.status === 'posted' && movements.length === 2 && movements.every((m) => m.movement_type === 'adjustment') && new Set(movements.map((m) => m.idempotency_key)).size === 1);
  check('A3 stock changed by the signed quantities', (await stockOf(world, a)).qty_on_hand.equals(7) && (await stockOf(world, b)).qty_on_hand.equals(15));
  const lineA = posted.items.find((item) => item.variant.id === a.id);
  const lineB = posted.items.find((item) => item.variant.id === b.id);
  check('A4 lines are valued at the warehouse average (loss -3 x 20, gain +5 x 30)', lineA.value === '-60.00' && lineB.value === '150.00' && lineA.qty_before === 10 && lineA.qty_after === 7, show([lineA.value, lineB.value]));
  check('A4 the average cost did not move', (await stockOf(world, a)).avg_cost.equals(20) && (await stockOf(world, b)).avg_cost.equals(30));
  const costRows = await prisma.inventoryCostMovement.count({ where: { tenant_id: world.tenant.id, reference_id: doc.id, movement_type: 'adjustment' } });
  check('A4 the cost ledger has a row per adjusted line', costRows === 2, `rows=${costRows}`);
  check('A4 posted totals carry the net value for a reader with cost access', posted.totals.net_value === '90.00' && posted.totals.increase_value === '150.00');
  check('A3 posting issues a constant number of statements (no per-line queries)', statements < 25, `statements=${statements}`);
  const replayed = await adjustments.post(world.context, doc.id, actorOf(world));
  check('A2 posting twice returns the posted document and moves nothing more', replayed.status === 'posted' && (await stockOf(world, a)).qty_on_hand.equals(7));

  const postedCancel = await rejection(adjustments.cancel(world.context, doc.id, {}, requester));
  check('A2 a posted document cannot be cancelled', codeOf(postedCancel) === 'ADJUSTMENT_ALREADY_POSTED');
  const stillPosted = await rejection(adjustments.approve(world.context, doc.id, actorOf(world)));
  check('A2 a posted document cannot be approved again', codeOf(stillPosted) === 'ADJUSTMENT_NOT_DRAFT');

  // A6 posted documents are immutable in the database too
  const rawItem = await rejection(prisma.$executeRaw`UPDATE "StockAdjustmentItem" SET "qty_delta" = 99 WHERE "adjustment_id" = ${doc.id}::uuid`);
  const rawHeader = await rejection(prisma.$executeRaw`UPDATE "StockAdjustment" SET "note" = 'tamper' WHERE "id" = ${doc.id}::uuid`);
  const rawDelete = await rejection(prisma.$executeRaw`DELETE FROM "StockAdjustmentItem" WHERE "adjustment_id" = ${doc.id}::uuid`);
  check('A6 a posted document and its lines cannot be changed or deleted by SQL', !!rawItem && !!rawHeader && !!rawDelete);
  const fresh = await draft([{ variant_id: c.id, qty_delta: 1, reason_code: 'found' }]);
  const skip = await rejection(prisma.$executeRaw`UPDATE "StockAdjustment" SET "status" = 'posted' WHERE "id" = ${fresh.id}::uuid`);
  check('A6 a draft cannot jump straight to posted', !!skip);

  // A5 negative stock is refused at posting and leaves the document approved
  const big = await draft([{ variant_id: a.id, qty_delta: -100, reason_code: 'lost_stolen' }]);
  await adjustments.approve(world.context, big.id, actorOf(world));
  const refused = await rejection(adjustments.post(world.context, big.id, actorOf(world)));
  const after = await adjustmentReads.get(world.context, big.id, actorOf(world));
  check('A5 a removal beyond the stock is refused by the engine rule', refused?.getStatus?.() === 409 && refused.response.code === 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY', show(codeOf(refused)));
  check('A5 the refused document stays approved and stock is untouched', after.status === 'approved' && (await stockOf(world, a)).qty_on_hand.equals(7));

  // cancel paths
  const cancelled = await adjustments.cancel(world.context, big.id, { reason: 'wrong count' }, actorOf(world, ['inventory.adjustment.approve']));
  check('A2 an approved document can be cancelled with a reason', cancelled.status === 'cancelled' && cancelled.cancellation_reason === 'wrong count');
  const revive = await rejection(adjustments.approve(world.context, big.id, actorOf(world)));
  check('A2 a cancelled document stays cancelled', codeOf(revive) === 'ADJUSTMENT_NOT_DRAFT');
  const cancelledDraft = await adjustments.cancel(world.context, fresh.id, {}, requester);
  check('A2 a draft can be cancelled', cancelledDraft.status === 'cancelled');

  // concurrent posts: one set of movements
  const race = await draft([{ variant_id: b.id, qty_delta: -1, reason_code: reason }]);
  await adjustments.approve(world.context, race.id, actorOf(world));
  await Promise.all([adjustments.post(world.context, race.id, actorOf(world)), adjustments.post(world.context, race.id, actorOf(world))]);
  const raceMovements = await prisma.inventoryMovement.count({ where: { tenant_id: world.tenant.id, reference_id: race.id } });
  check('A7 two simultaneous posts apply the document once', raceMovements === 1 && (await stockOf(world, b)).qty_on_hand.equals(14));

  // refusals at creation
  const serial = await createVariant(world, { tracking: 'serial' });
  const trackedDraft = await rejection(draft([{ variant_id: serial.id, qty_delta: 1, reason_code: 'found' }]));
  check('A8 a tracked variant is refused with a clear code and line index', codeOf(trackedDraft) === 'TRACKED_VARIANT_NOT_SUPPORTED' && trackedDraft.response.data.line_index === 0);
  const dup = await rejection(draft([{ variant_id: a.id, qty_delta: 1, reason_code: 'found' }, { variant_id: a.id, qty_delta: 2, reason_code: 'found' }]));
  check('A8 a repeated item is refused', codeOf(dup) === 'DUPLICATE_LINE');

  // list
  const list = await adjustmentReads.list(world.context, { page: 1, page_size: 50 }, requester);
  check('A9 the list reports counts per status and the net value for cost readers', list.status_counts.posted === 2 && list.status_counts.cancelled === 2 && list.total === 4 && typeof list.items[0].net_value === 'string', show(list.status_counts));
  const noCost = await adjustmentReads.get(world.context, doc.id, actorOf(world, []));
  check('A9 cost is hidden from a reader without inventory.position.view-cost', !('unit_cost' in noCost.items[0]) && !('net_value' in noCost.totals));

  // tenants
  const other = await createTenantWorld('adjust-other');
  const foreign = await rejection(adjustments.approve(other.context, doc.id, actorOf(other)));
  check('A10 another tenant cannot approve or read the document', foreign?.getStatus?.() === 404 && !!(await rejection(adjustmentReads.get(other.context, doc.id, actorOf(other)))));
  const foreignDraft = await rejection(adjustments.create(other.context, { branch_id: world.branch.id, lines }, actorOf(other)));
  check('A10 another tenant cannot draft into this branch', foreignDraft?.getStatus?.() === 404);
}

// --- C: stock counts -----------------------------------------------------------

async function verifyStockCounts() {
  const world = await createTenantWorld('count');
  const cost = ['inventory.position.view-cost'];
  const counter = actorOf(world, ['inventory.adjustment.request', ...cost]);
  const reviewer = actorOf(world, ['inventory.adjustment.request', 'inventory.adjustment.approve', ...cost]);
  const start = (extra = {}, actor = reviewer) =>
    counts.start(world.context, { branch_id: world.branch.id, scope: { type: 'all' }, ...extra }, actor);
  const scan = (countId, entries, actor = counter) => countScans.record(world.context, countId, { entries }, actor);
  const entry = (extra) => ({ entry_id: `e-${randomUUID()}`, ...extra });
  const onHand = async (variant) => Number((await stockOf(world, variant)).qty_on_hand);

  const [x, y, z, w, v] = await createVariants(world, 5);
  for (const variant of [x, y, z, w, v]) await openStock(world, variant, 10, 20);

  // C1 start, one open count, scopes
  const count = await start();
  check('C1 a count starts open with a number, default name and scope all', count.status === 'open' && /^CNT-\d{6}$/.test(count.count_number) && count.name.includes('جرد') && count.scope.type === 'all');
  const again = await rejection(start());
  check('C1 a second open count of the warehouse is refused and names the running one', codeOf(again) === 'STOCK_COUNT_ALREADY_OPEN' && again.response.data.count_id === count.id, show(codeOf(again)));
  const cat1 = await prisma.category.create({ data: { tenant_id: world.tenant.id, name_ar: 'قسم 1' } });
  const cat2 = await prisma.category.create({ data: { tenant_id: world.tenant.id, name_ar: 'قسم 2' } });
  const overlap = await rejection(start({ scope: { type: 'category', id: cat1.id } }));
  check('C1 a category count overlaps the open all-items count and is refused', codeOf(overlap) === 'STOCK_COUNT_ALREADY_OPEN');
  const rawSecond = await rejection(
    prisma.stockCount.create({
      data: { tenant_id: world.tenant.id, branch_id: world.branch.id, warehouse_id: world.warehouse.id, count_number: `CNT-raw-${randomUUID().slice(0, 6)}`, name: 'raw', scope_type: 'all', scope_key: 'all' },
    }),
  );
  check('C1 the one-open-count index also holds in the database', !!rawSecond);

  // C2 scanning: barcode +1, pack barcode, idempotent retry, set, undo, unknown
  await prisma.productBarcode.createMany({
    data: [
      { tenant_id: world.tenant.id, code: `BC-${x.sku}`, variant_id: x.id },
      { tenant_id: world.tenant.id, code: `PACK-${x.sku}`, variant_id: x.id, pack_qty: D(6) },
    ],
  });
  const first = entry({ barcode: `BC-${x.sku}` });
  let res = await scan(count.id, [first]);
  check('C2 "+1 of barcode X" counts one and returns the running totals', res.results[0].status === 'counted' && res.results[0].added === 1 && res.results[0].counted_total === 1 && res.results[0].counted_by_me === 1 && res.results[0].expected_at_count === 10, show(res.results[0]));
  res = await scan(count.id, [first]);
  check('C2 re-sending the same entry id changes nothing (duplicate)', res.results[0].status === 'duplicate' && res.results[0].counted_total === 1);
  res = await scan(count.id, [entry({ barcode: `PACK-${x.sku}` })]);
  check('C2 a pack barcode adds its pack quantity', res.results[0].added === 6 && res.results[0].counted_total === 7 && res.results[0].pack_qty === 6);
  res = await scan(count.id, [entry({ variant_id: x.id, mode: 'set', qty: 8 })]);
  check('C2 "set" makes this counter\'s total exactly the typed quantity', res.results[0].counted_total === 8 && res.results[0].counted_by_me === 8);
  res = await scan(count.id, [entry({ variant_id: x.id, qty: -1 })]);
  check('C2 a negative add undoes a scan', res.results[0].counted_total === 7);
  res = await scan(count.id, [entry({ variant_id: x.id, qty: -50 })]);
  check('C2 a counter cannot take more than they counted', res.results[0].status === 'below_zero' && res.results[0].counted_total === 7);
  res = await scan(count.id, [entry({ barcode: 'NO-SUCH-CODE' }), entry({ variant_id: randomUUID() })]);
  check('C2 an unknown barcode and an unknown item get a clear status, not an error', res.results[0].status === 'unknown_barcode' && !!res.results[0].message_ar && res.results[1].status === 'variant_not_found');
  const serial = await createVariant(world, { tracking: 'serial' });
  res = await scan(count.id, [entry({ variant_id: serial.id })]);
  check('C2 a serial-tracked item is refused with its status', res.results[0].status === 'tracked_not_supported');
  check('C2 scanning moved no stock', (await onHand(x)) === 10);

  // two counters add up; "mine" is per counter
  const helper = await prisma.user.create({ data: { name: 'Helper', password_hash: 'x' } });
  const helperActor = actorOf(world, ['inventory.adjustment.request'], { sub: helper.id });
  res = await scan(count.id, [entry({ variant_id: x.id, qty: 2 })], helperActor);
  check('C2 two counters add up; each sees their own part', res.results[0].counted_total === 9 && res.results[0].counted_by_me === 2);
  res = await scan(count.id, [entry({ variant_id: x.id, mode: 'set', qty: 0 })], helperActor);
  check('C2 a counter can only change their own part', res.results[0].counted_total === 7 && res.results[0].counted_by_me === 0);

  // statements do not grow with the batch
  const bulk = await createVariants(world, 30);
  const [, one] = await counted(() => scan(count.id, [entry({ variant_id: bulk[0].id })]));
  const [, many] = await counted(() => scan(count.id, bulk.slice(1).map((variant) => entry({ variant_id: variant.id, qty: 2 }))));
  check('C2 scanning 1 entry and 29 entries use the same number of statements', one === many, `1=${one}, 29=${many}`);
  for (const variant of bulk) await countScans.resetLine(world.context, count.id, variant.id, reviewer);

  // concurrent batches for one new item sum up exactly
  const [t1, t2] = await Promise.all([
    scan(count.id, [entry({ variant_id: w.id, qty: 3 })]),
    scan(count.id, [entry({ variant_id: w.id, qty: 4 })], helperActor),
  ]);
  const wLine = await prisma.stockCountLine.findFirstOrThrow({ where: { count_id: count.id, variant_id: w.id } });
  check('C2 concurrent scans of one new item create one line and sum', Number(wLine.counted_qty) === 7 && [t1, t2].every((r) => r.results[0].status === 'counted'), `counted=${wLine.counted_qty}`);
  await countScans.resetLine(world.context, count.id, w.id, reviewer);

  // C3 sales before and after an item is counted are both preserved
  // x was counted (7) while on hand 10: expected 10; 3 sell after it was counted.
  await sell(world, x, 3);
  await sell(world, y, 2); // y sold BEFORE it is counted: on hand 8
  res = await scan(count.id, [entry({ variant_id: y.id, mode: 'set', qty: 8 })]);
  check('C3 an item sold before counting is expected at its balance when counted', res.results[0].expected_at_count === 8);
  await sell(world, y, 1); // sold AFTER counting: on hand 7
  await sell(world, z, 2); // on hand 8, before counting
  res = await scan(count.id, [entry({ variant_id: z.id, mode: 'set', qty: 7 })]); // one is really missing
  await sell(world, z, 1); // after counting: on hand 7

  const review = await countReads.review(world.context, count.id, { page: 1, page_size: 50 }, reviewer);
  const row = (variant) => review.items.find((item) => item.variant.id === variant.id);
  check('C3 review: x counted 7 of 10 expected, 3 sold after counting', row(x).variance === -3 && row(x).movement_after_count === -3 && row(x).current_on_hand === 7, show(row(x)));
  check('C3 review: y counted 8 of 8 expected, 1 sold after -> no variance', row(y).variance === 0 && row(y).movement_after_count === -1 && row(y).current_on_hand === 7, show(row(y)));
  check('C3 review: z counted 7 of 8 expected -> -1, 1 sold after', row(z).variance === -1 && row(z).movement_after_count === -1, show(row(z)));
  check('C3 review: uncounted items with a balance and unknown barcodes are listed separately', review.summary.uncounted_items === 2 && review.unknown_barcodes.length === 1 && review.unknown_barcodes[0].barcode === 'NO-SUCH-CODE', show(review.summary));
  check('C3 review: summary counts items and values the variance at cost', review.summary.counted_items === 3 && review.summary.items_with_variance === 2 && review.summary.decrease_qty === 4 && review.summary.decrease_value === '-80.00', show(review.summary));
  const noCost = await countReads.review(world.context, count.id, { page: 1, page_size: 50 }, actorOf(world, ['inventory.adjustment.request', 'inventory.adjustment.approve']));
  check('C3 review: cost columns are hidden without inventory.position.view-cost', !('unit_cost' in noCost.items[0]) && !('net_value' in noCost.summary));
  const onlyUncounted = await countReads.review(world.context, count.id, { page: 1, page_size: 50, filter: 'uncounted' }, reviewer);
  check('C3 review filter "uncounted" lists w and v', onlyUncounted.total === 2 && onlyUncounted.items.every((item) => item.status === 'uncounted'));

  // C4 posting: the uncounted decision is required, then one engine command
  const poster = actorOf(world, ['inventory.adjustment.post']);
  const undecided = await rejection(counts.post(world.context, count.id, {}, poster));
  check('C4 posting with uncounted items needs an explicit choice', codeOf(undecided) === 'STOCK_COUNT_UNCOUNTED_DECISION_REQUIRED' && undecided.response.data.uncounted_items === 2);
  const [posted, postStatements] = await counted(() => counts.post(world.context, count.id, { uncounted: 'ignore', zero_variant_ids: [v.id] }, poster));
  check('C4 the count is posted', posted.status === 'posted' && posted.uncounted_choice === 'ignore');
  check('C4 x: 10 expected, 7 counted, 3 sold after -> 4 on hand (variance -3 applied on top of the later sale)', (await onHand(x)) === 4, `on hand=${await onHand(x)}`);
  check('C4 y: no variance, the sale after counting stays -> 7', (await onHand(y)) === 7, `on hand=${await onHand(y)}`);
  check('C4 z: -1 variance on top of the later sale -> 6', (await onHand(z)) === 6, `on hand=${await onHand(z)}`);
  check('C4 an uncounted item left alone keeps its balance; the one chosen as zero is zeroed', (await onHand(w)) === 10 && (await onHand(v)) === 0);
  const movements = await prisma.inventoryMovement.findMany({ where: { tenant_id: world.tenant.id, reference_type: 'StockCount', reference_id: count.id } });
  check('C4 posting is one stock_count engine command (one key) with a line per changed item', movements.length === 3 && movements.every((m) => m.movement_type === 'stock_count') && new Set(movements.map((m) => m.idempotency_key)).size === 1, `movements=${movements.length}`);
  check('C4 posting issues a constant number of statements', postStatements < 35, `statements=${postStatements}`);
  const lines = await prisma.stockCountLine.findMany({ where: { count_id: count.id } });
  check('C4 lines are stamped with the applied change and cost; the zeroed item has its own line', lines.find((l) => l.variant_id === x.id).applied_delta.equals(-3) && lines.find((l) => l.variant_id === v.id).zeroed === true && lines.find((l) => l.variant_id === x.id).unit_cost.equals(20));
  const replay = await counts.post(world.context, count.id, { uncounted: 'ignore' }, poster);
  check('C4 posting twice applies once', replay.status === 'posted' && (await onHand(x)) === 4);
  const closedScan = await rejection(scan(count.id, [entry({ variant_id: x.id })]));
  check('C4 a posted count refuses scans', codeOf(closedScan) === 'STOCK_COUNT_CLOSED');
  const cancelPosted = await rejection(counts.cancel(world.context, count.id, {}, reviewer));
  check('C4 a posted count cannot be cancelled', codeOf(cancelPosted) === 'STOCK_COUNT_CLOSED');

  // C5 "zero" choice, scope by category, and posting that would go negative
  const catItems = await createVariants(world, 2, { product: { category_id: cat1.id } });
  for (const variant of catItems) await openStock(world, variant, 6, 10);
  const other = await createVariant(world, { product: { category_id: cat2.id } });
  await openStock(world, other, 6, 10);
  const catCount = await start({ scope: { type: 'category', id: cat1.id }, name: 'Category count', command_id: `cmd-${randomUUID()}` });
  check('C5 a category count covers only its category', catCount.items_in_scope === 2 && catCount.scope.name === 'قسم 1' && catCount.name === 'Category count');
  const secondCat = await rejection(start({ scope: { type: 'category', id: cat2.id } }));
  check('C5 a second category count of another category may run at the same time', secondCat === null);
  res = await scan(catCount.id, [entry({ variant_id: other.id })]);
  check('C5 an item outside the scope is refused unless a reviewer allows it', res.results[0].status === 'out_of_scope');
  res = await scan(catCount.id, [entry({ variant_id: other.id, allow_out_of_scope: true, mode: 'set', qty: 6 })], reviewer);
  check('C5 a reviewer may count it anyway', res.results[0].status === 'counted');
  res = await scan(catCount.id, [entry({ variant_id: catItems[0].id, mode: 'set', qty: 1 })]);
  await sell(world, catItems[0], 4); // on hand 2, counted 1 of 6 expected: variance -5 would go negative
  const negative = await rejection(counts.post(world.context, catCount.id, { uncounted: 'zero' }, poster));
  check('C5 posting that would push an item below zero is refused and names it', codeOf(negative) === 'STOCK_COUNT_WOULD_GO_NEGATIVE' && negative.response.data.items[0].variant_id === catItems[0].id, show(codeOf(negative)));
  check('C5 the refused count stays open and stock is untouched', (await onHand(catItems[0])) === 2 && (await countReads.get(world.context, catCount.id, reviewer)).status === 'open');
  await countScans.resetLine(world.context, catCount.id, catItems[0].id, reviewer);
  const zeroed = await counts.post(world.context, catCount.id, { uncounted: 'zero', keep_variant_ids: [catItems[1].id] }, poster);
  check('C5 "zero" zeroes the uncounted item (2 -> 0) except the ones kept; the out-of-scope item counted as-is', zeroed.status === 'posted' && (await onHand(catItems[0])) === 0 && (await onHand(catItems[1])) === 6 && (await onHand(other)) === 6);

  // C6 cancel, and another tenant
  const secondOpen = (await countReads.list(world.context, { page: 1, page_size: 50, status: 'open' }, reviewer)).items;
  for (const open of secondOpen) await counts.cancel(world.context, open.id, { reason: 'cleanup' }, reviewer);
  const toCancel = await start({ name: 'to cancel' });
  const cancelled = await counts.cancel(world.context, toCancel.id, { reason: 'test' }, reviewer);
  check('C6 an open count can be cancelled and then frees the warehouse', cancelled.status === 'cancelled' && (await start({ name: 'after cancel' })).status === 'open');
  const foreign = await createTenantWorld('count-other');
  const foreignGet = await rejection(countReads.get(foreign.context, toCancel.id, actorOf(foreign)));
  const foreignScan = await rejection(countScans.record(foreign.context, toCancel.id, { entries: [entry({ variant_id: x.id })] }, actorOf(foreign)));
  const foreignStart = await rejection(counts.start(foreign.context, { branch_id: world.branch.id, scope: { type: 'all' } }, actorOf(foreign)));
  check('C6 another tenant cannot read, scan or start a count on this branch', foreignGet?.getStatus?.() === 404 && foreignScan?.getStatus?.() === 404 && foreignStart?.getStatus?.() === 404);
  const foreignCategory = await prisma.category.create({ data: { tenant_id: foreign.tenant.id, name_ar: 'x' } });
  const foreignScope = await rejection(start({ scope: { type: 'category', id: foreignCategory.id } }));
  check('C6 another tenant\'s category is not a valid scope', codeOf(foreignScope) === 'STOCK_COUNT_SCOPE_NOT_FOUND');
  const list = await countReads.list(world.context, { page: 1, page_size: 50 }, reviewer);
  check('C6 the list carries scope, progress and status counts', list.status_counts.posted === 2 && list.status_counts.open === 1 && list.items.every((item) => typeof item.items_in_scope === 'number'), show(list.status_counts));
  const recent = await countReads.recent(world.context, count.id, { page: 1, page_size: 50 }, counter);
  check('C6 a counter sees their own recently counted items', recent.total === 3 && recent.items.every((item) => item.counted_by_me > 0), show(recent.total));
}

// --- L: items at or below zero / without a stock row ----------------------------

async function verifyLowStock() {
  const world = await createTenantWorld('low');
  const reader = actorOf(world, ['inventory.position.view', 'inventory.position.view-cost']);
  const [zero, negative, positive, fresh] = await createVariants(world, 4);
  const service = await createVariant(world, { item_type: 'service' });
  const archived = await createVariant(world, { is_active: false });
  await openStock(world, zero, 3, 20);
  await sell(world, zero, 3);
  await sell(world, negative, 2);
  await openStock(world, positive, 5, 20);
  const page = (extra = {}, actor = reader) => lowStock.list(world.context, { page: 1, page_size: 50, branch_id: world.branch.id, ...extra }, actor);

  const all = await page();
  check('L1 "all" lists zero and negative items, the most negative first', all.items.map((item) => item.variant.id).join() === [negative.id, zero.id].join() && all.items[0].status === 'negative' && all.items[1].status === 'zero', show(all.items.map((i) => [i.variant.sku, i.status, i.qty_on_hand])));
  check('L1 tab counts', all.counts.all === 2 && all.counts.zero === 1 && all.counts.negative === 1 && all.counts.no_stock_row === 1, show(all.counts));
  check('L1 a positive balance, a service and an archived item are not listed', !all.items.some((item) => [positive.id, service.id, archived.id].includes(item.variant.id)));
  check('L1 the row carries the quantity as a number, last sale and cost for a cost reader', all.items[0].qty_on_hand === -2 && all.items[0].last_sold_at !== null && all.items[0].cost_price === '10.0000');
  check('L1 cost is hidden without the cost permission', !('cost_price' in (await page({}, actorOf(world, ['inventory.position.view']))).items[0]));
  check('L1 the negative and zero tabs filter', (await page({ status: 'negative' })).total === 1 && (await page({ status: 'zero' })).items[0].variant.id === zero.id);

  const none = await page({ status: 'no_stock_row' });
  check('L2 items with no stock row in the branch (never a movement), excluding service and archived', none.total === 1 && none.items[0].variant.id === fresh.id && none.items[0].status === 'no_stock_row' && none.items[0].qty_on_hand === null, show(none.items.map((i) => i.variant.sku)));
  const needsBranch = await rejection(lowStock.list(world.context, { page: 1, page_size: 50, status: 'no_stock_row' }, reader));
  check('L2 "no stock row" needs a branch', codeOf(needsBranch) === 'BRANCH_REQUIRED');
  const search = await page({ q: negative.sku });
  check('L2 search matches the SKU', search.total === 1 && search.items[0].variant.id === negative.id);

  // a second branch is a different warehouse: nothing has a row there yet
  const branch2 = await new BranchesRepository(prisma).save(world.context, { code: `L2-${randomUUID().slice(0, 6)}`, name_ar: 'فرع 2' });
  const other = await lowStock.list(world.context, { page: 1, page_size: 50, branch_id: branch2.id, status: 'no_stock_row' }, reader);
  check('L3 another branch has its own stock: every stocked item has no row there', other.total === 4 && other.counts.all === 0, `total=${other.total}`);
  const scoped = actorOf(world, ['inventory.position.view'], { scope_set: [{ scope_type: 'location', scope_ref_id: branch2.id }] });
  const forbidden = await rejection(lowStock.list(world.context, { page: 1, page_size: 50, branch_id: world.branch.id }, scoped));
  check('L3 a user scoped to another branch cannot read this branch', forbidden?.getStatus?.() === 403);
  const foreign = await createTenantWorld('low-other');
  const foreignView = await lowStock.list(foreign.context, { page: 1, page_size: 50, branch_id: foreign.branch.id }, actorOf(foreign, ['inventory.position.view']));
  check('L3 another tenant sees none of these items', foreignView.total === 0);
}

// --- main -----------------------------------------------------------------------

async function main() {
  const sections = [verifyOpeningBalance, verifyAdjustments, verifyStockCounts, verifyLowStock];
  for (const section of sections) {
    try {
      await section();
    } catch (error) {
      failed += 1;
      process.stdout.write(`FAIL  ${section.name} crashed -- ${error?.stack ?? error}\n`);
    }
  }
  await prisma.$disconnect();
  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll stock onboarding checks passed\n');
  process.exit(failed ? 1 : 0);
}

main();
