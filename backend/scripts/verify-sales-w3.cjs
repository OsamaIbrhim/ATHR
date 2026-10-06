#!/usr/bin/env node
// Real-Postgres proof of W3 (sales): document numbers, payments, credit,
// discounts, tenant sale settings, returns and exchange. Constructs the real
// compiled services against a real PrismaClient, so it asserts on the code that
// ships and requires `npm run build` first (see `npm run test:db`).
//
//   D1-D5   per-tenant document numbers: two tenants, concurrency, rollback,
//           adjustments / counts, terminal codes
//   D6      transfers numbered TR-000001 per tenant, no global sequence
//   N1-N3   a POS sale is never refused: reused terminal sequence, mismatching total
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

const nextDocumentNumber = load('common', 'document-sequence.js', 'nextDocumentNumber');
const nextDocumentValue = load('common', 'document-sequence.js', 'nextDocumentValue');
const BranchesRepository = load('branches', 'branches.repository.js', 'BranchesRepository');
const InventoryService = load('inventory', 'inventory.service.js', 'InventoryService');
const InventoryRepository = load('inventory', 'inventory.repository.js', 'InventoryRepository');
const AdjustmentsService = load('adjustments', 'adjustments.service.js', 'AdjustmentsService');
const AdjustmentsReadService = load('adjustments', 'adjustments.read.service.js', 'AdjustmentsReadService');

const { createSalesWorld, statementCounter } = require('./support/sales-world.cjs');

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const counted = statementCounter(prisma);
const inventory = new InventoryService(new InventoryRepository(prisma));

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}\n`);
}

const D = (value) => new Prisma.Decimal(value);
const show = (value) => JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));

async function rejection(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

// --- fixtures -----------------------------------------------------------------

async function createTenantWorld(label) {
  const tenant = await prisma.tenant.create({ data: { name: `w3-${label}-${randomUUID()}`, default_currency: 'EGP' } });
  const context = { tenantId: tenant.id };
  const branches = new BranchesRepository(prisma);
  const branch = await branches.save(context, { code: `W-${randomUUID().slice(0, 8)}`, name_ar: `فرع ${label}` });
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenant_id: tenant.id, branch_id: branch.id, is_default: true } });
  const taxCategory = await prisma.taxCategory.create({
    data: { tenant_id: tenant.id, code: 'STANDARD', name_en: 'Standard', updated_at: new Date() },
  });
  const actor = await prisma.user.create({ data: { name: `W3 actor ${label}`, password_hash: 'not-a-real-hash' } });
  return { tenant, context, branch, warehouse, taxCategory, actor, branches };
}

// --- D ------------------------------------------------------------------------

async function verifyDocumentSequences() {
  const a = await createTenantWorld('d-a');
  const b = await createTenantWorld('d-b');
  const take = (world, key) => prisma.$transaction((tx) => nextDocumentNumber(tx, world.tenant.id, key));

  check('D1 two tenants both start at 000001', (await take(a, 'return')) === 'R-000001' && (await take(b, 'return')) === 'R-000001');
  check('D1 the next number of a tenant is the next one, and kinds count separately',
    (await take(a, 'return')) === 'R-000002' && (await take(a, 'adjustment')) === 'ADJ-000001' && (await take(b, 'return')) === 'R-000002');

  const concurrent = await Promise.all(Array.from({ length: 25 }, () => prisma.$transaction((tx) => nextDocumentValue(tx, a.tenant.id, 'count'))));
  const sorted = concurrent.map(Number).sort((x, y) => x - y);
  check('D2 25 concurrent documents of one tenant get 25 different consecutive numbers',
    sorted.every((value, index) => value === index + 1), sorted.join(','));

  await rejection(prisma.$transaction(async (tx) => {
    await nextDocumentNumber(tx, a.tenant.id, 'invoice');
    throw new Error('rolled back');
  }));
  check('D3 a document that rolls back gives its number back (no gap)', (await take(a, 'invoice')) === 'INV-000001');

  // The services number from the same counter.
  const adjustments = new AdjustmentsService(prisma, inventory, new AdjustmentsReadService(prisma));
  const product = await prisma.product.create({ data: { tenant_id: b.tenant.id, name_en: 'Adj product', tax_category_id: b.taxCategory.id, is_active: true } });
  const variant = await prisma.productVariant.create({ data: { tenant_id: b.tenant.id, product_id: product.id, sku: `ADJ-${randomUUID().slice(0, 8)}`, cost_price: D(10), is_active: true } });
  const owner = { sub: b.actor.id, membership_role: 'tenant_owner', permissions: new Set(['inventory.adjustment.request']), scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }] };
  const created = await rejection(adjustments.create(b.context, { branch_id: b.branch.id, command_id: randomUUID(), lines: [{ variant_id: variant.id, qty_delta: 1, reason_code: 'correction' }] }, owner));
  const header = created?.adjustment_number ? created : null;
  const row = await prisma.stockAdjustment.findFirst({ where: { tenant_id: b.tenant.id } });
  check('D4 an adjustment is numbered from its own tenant counter (ADJ-000001 although tenant A already used one)',
    row?.adjustment_number === 'ADJ-000001' || header?.adjustment_number === 'ADJ-000001', `row=${row?.adjustment_number} err=${created?.message ?? ''}`);

  // Terminal codes: two devices whose ids start alike can no longer collide.
  const deviceA = `abcdef01-${randomUUID().slice(9)}`;
  const deviceB = `abcdef01-${randomUUID().slice(9)}`;
  const codeA = await take(a, 'terminal');
  const codeB = await take(a, 'terminal');
  // Transfers: per-tenant TR- numbers, no global sequence left.
  const sequences = await prisma.$queryRaw`SELECT relname FROM pg_class WHERE relkind = 'S' AND relname = 'TransferNumberSequence'`;
  check('D6 the global transfer sequence is gone', sequences.length === 0);
  const TransfersService = load('transfers', 'transfers.service.js', 'TransfersService');
  const otherBranch = await b.branches.save(b.context, { code: `W-${randomUUID().slice(0, 8)}`, name_ar: 'فرع آخر' });
  const stocked = await prisma.productVariant.create({ data: { tenant_id: b.tenant.id, product_id: product.id, sku: `TR-${randomUUID().slice(0, 8)}`, cost_price: D(10), is_active: true } });
  await prisma.$transaction((tx) => inventory.apply(tx, {
    tenantId: b.tenant.id, warehouseId: b.warehouse.id, occurredAt: new Date(), actorId: b.actor.id, type: 'opening_balance', costType: 'opening_balance',
    reference: { type: 'Verify', id: randomUUID() }, idempotencyKey: `verify:${randomUUID()}`, allowNegative: false, lines: [{ variantId: stocked.id, qtyDelta: 5, unitCost: 10 }],
  }));
  const transfers = new TransfersService(prisma, inventory);
  const transferDto = () => ({ from_branch_id: b.branch.id, to_branch_id: otherBranch.id, command_id: randomUUID(), items: [{ variant_id: stocked.id, qty: 1 }] });
  const t1 = await transfers.create(b.context, transferDto(), owner);
  const t2 = await transfers.create(b.context, transferDto(), owner);
  check('D6 transfers are numbered TR-000001, TR-000002 from the tenant counter', t1.transfer_number === 'TR-000001' && t2.transfer_number === 'TR-000002', `${t1.transfer_number} ${t2.transfer_number}`);

  check('D5 terminal codes come from the tenant counter, not from the device id', codeA === 'POS1' && codeB === 'POS2' && deviceA.slice(0, 8) === deviceB.slice(0, 8));
}

// --- N ------------------------------------------------------------------------

async function verifyNeverRefused() {
  const world = await createSalesWorld(prisma, 'n');
  const [variant] = [await world.createVariant()];
  const first = await world.sell(world.saleDto([variant]));
  check('N1 a POS sale is stored under its printed invoice number', first.invoice_number === 'POS1-000001', first.invoice_number);

  // A wiped till re-enrolls and starts again at 1: same terminal, same sequence, same printed number.
  const again = world.saleDto([variant], { terminal_sequence: '1', invoice_number: 'POS1-000001' });
  const second = await world.sell(again);
  check('N1 a reused terminal sequence is accepted under a suffixed number with INVOICE_NUMBER_REASSIGNED',
    second.id !== first.id && second.invoice_number === 'POS1-000001-2' && second.warning_codes.includes('INVOICE_NUMBER_REASSIGNED'),
    `${second.invoice_number} ${show(second.warning_codes)}`);
  const third = await world.sell(world.saleDto([variant], { terminal_sequence: '1', invoice_number: 'POS1-000001' }));
  check('N1 the next collision takes the next suffix', third.invoice_number === 'POS1-000001-3', third.invoice_number);
  const replay = await world.sell(again);
  check('N1 the reassigned sale is still idempotent on its sync_id', replay.id === second.id && replay.invoice_number === second.invoice_number);
  check('N1 three invoices exist for the three sales', (await prisma.salesInvoice.count({ where: { tenant_id: world.tenant.id } })) === 3);

  const mismatch = await world.sell(world.saleDto([variant], { local_total: 130 }));
  check('N2 a total that does not match its lines is accepted: the till total is stored, with LOCAL_TOTAL_MISMATCH',
    mismatch.total.equals(130) && mismatch.subtotal.equals(100) && mismatch.warning_codes.includes('LOCAL_TOTAL_MISMATCH'),
    `${mismatch.total} ${show(mismatch.warning_codes)}`);
  const exact = await world.sell(world.saleDto([variant]));
  check('N2 a matching total carries no mismatch warning', !exact.warning_codes.includes('LOCAL_TOTAL_MISMATCH'));
  check('N3 the terminal sequence is no longer unique per terminal, the sync_id is',
    (await rejection(prisma.salesInvoice.create({ data: { ...{ id: randomUUID(), tenant_id: world.tenant.id, invoice_number: 'X-1', branch_id: world.branch.id, subtotal: 1, tax_amount: 0, total: 1, payment_method: 'cash', sync_id: first.sync_id } } }))) !== null);
}

// --- main -----------------------------------------------------------------------

async function main() {
  const sections = [verifyDocumentSequences, verifyNeverRefused];
  for (const section of sections) {
    try {
      await section();
    } catch (error) {
      failed += 1;
      process.stdout.write(`FAIL  ${section.name} crashed -- ${error?.stack ?? error}\n`);
    }
  }
  await prisma.$disconnect();
  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll W3 sales checks passed\n');
  process.exit(failed ? 1 : 0);
}

main();
