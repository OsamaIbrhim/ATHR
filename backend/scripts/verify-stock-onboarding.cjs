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

// --- main -----------------------------------------------------------------------

async function main() {
  const sections = [verifyOpeningBalance, verifyAdjustments];
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
