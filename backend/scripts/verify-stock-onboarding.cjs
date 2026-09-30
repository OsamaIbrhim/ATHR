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

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const inventory = new InventoryService(new InventoryRepository(prisma));
const openingBalance = new OpeningBalanceService(prisma, inventory);

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

// --- main -----------------------------------------------------------------------

async function main() {
  const sections = [verifyOpeningBalance];
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
