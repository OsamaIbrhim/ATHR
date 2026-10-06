#!/usr/bin/env node
// Real-Postgres proof of W3 (sales): document numbers, payments, credit,
// discounts, tenant sale settings, returns and exchange. Constructs the real
// compiled services against a real PrismaClient, so it asserts on the code that
// ships and requires `npm run build` first (see `npm run test:db`).
//
//   D1-D5   per-tenant document numbers: two tenants, concurrency, rollback,
//           adjustments / counts, terminal codes
//   D6      transfers numbered TR-000001 per tenant, no global sequence
//   P1-P4   payments: split rows, warnings, 17 statements, shift cash from payments
//   X1-X6   discounts: line + invoice, tax after discount, snapshot, limit warning, merge, fingerprint
//   C1-C8   credit: balance + ledger, limit warning, collections, shift cash, append-only, debtors, statement
//   N1-N3   a POS sale is never refused: reused terminal sequence, mismatching total, no number
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
  const bare = world.saleDto([variant]);
  delete bare.invoice_number;
  const derived = await world.sell(bare);
  check('N3 a sale without a printed number gets {terminal_code}-{sequence} and a warning',
    derived.invoice_number === 'POS1-' + String(bare.terminal_sequence).padStart(6, '0') && derived.warning_codes.includes('INVOICE_NUMBER_REASSIGNED'), derived.invoice_number);
}

// --- P ------------------------------------------------------------------------

const SALE_STATEMENTS = 17;

async function verifyPayments() {
  const world = await createSalesWorld(prisma, 'p');
  const variants = [];
  for (let i = 0; i < 30; i += 1) variants.push(await world.createVariant());
  await prisma.$transaction((tx) => world.inventory.apply(tx, {
    tenantId: world.tenant.id, warehouseId: world.warehouse.id, occurredAt: new Date(), actorId: world.cashier.id, type: 'opening_balance', costType: 'opening_balance',
    reference: { type: 'Verify', id: randomUUID() }, idempotencyKey: `verify:${randomUUID()}`, allowNegative: false,
    lines: variants.map((variant) => ({ variantId: variant.id, qtyDelta: 100, unitCost: 60 })),
  }));
  await world.sell(world.saleDto(variants.slice(0, 1))); // warm caches

  const split = await world.sell(world.saleDto(variants.slice(1, 2), { payments: [
    { method: 'cash', amount: 100, tendered: 200 }, { method: 'card', amount: 14, reference: '****4242' },
  ] }));
  const stored = await prisma.salesPayment.findMany({ where: { sales_invoice_id: split.id }, orderBy: { sequence: 'asc' } });
  check('P1 a split payment is stored as one row per tender, in order',
    stored.length === 2 && stored[0].method === 'cash' && stored[0].amount.equals(100) && stored[0].tendered.equals(200) && stored[1].method === 'card' && stored[1].reference === '****4242',
    show(stored.map((row) => [row.sequence, row.method, String(row.amount)])));
  check('P1 the sale response carries its payments and no mismatch warning', split.payments.length === 2 && !split.warning_codes.includes('PAYMENT_TOTAL_MISMATCH'));

  const off = await world.sell(world.saleDto(variants.slice(2, 3), { payments: [{ method: 'bank_transfer', amount: 100 }] }));
  check('P2 payments that do not add up and a disabled method are accepted with warnings',
    off.warning_codes.includes('PAYMENT_TOTAL_MISMATCH') && off.warning_codes.includes('PAYMENT_METHOD_DISABLED'), show(off.warning_codes));

  const [one, one_n] = await counted(() => world.sell(world.saleDto(variants.slice(3, 4))));
  const [many, many_n] = await counted(() => world.sell(world.saleDto(variants)));
  check(`P3 a sale costs ${SALE_STATEMENTS} statements for 1 line and for 30 lines`, one_n === SALE_STATEMENTS && many_n === SALE_STATEMENTS, `1 line=${one_n}, 30 lines=${many_n}`);
  const [withCustomer, customer_n] = await counted(() => world.sell(world.saleDto(variants.slice(4, 5), { customer_phone: '01099999999' })));
  check(`P3 a sale with a customer costs ${SALE_STATEMENTS + 1}`, customer_n === SALE_STATEMENTS + 1 && !!withCustomer.customer_id, `got ${customer_n}`);

  // The shift counts cash payments only: 100 cash from the split sale, plus 114 + 3420 cash from the one/many sales, plus the others.
  const ShiftsService = load('shifts', 'shifts.service.js', 'ShiftsService');
  const ShiftsRepository = load('shifts', 'shifts.repository.js', 'ShiftsRepository');
  const cashRows = await prisma.salesPayment.findMany({ where: { tenant_id: world.tenant.id, method: 'cash' } });
  const cash = cashRows.reduce((sum, row) => sum.plus(row.amount), D(0));
  const shifts = new ShiftsService(prisma, new ShiftsRepository(prisma));
  const actor = { sub: world.cashier.id, membership_role: 'tenant_owner', permissions: new Set(), scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }] };
  await shifts.close(world.context, world.shift.id, actor, Number(cash));
  const closed = await prisma.shift.findUniqueOrThrow({ where: { id: world.shift.id } });
  check('P4 expected cash at shift close = opening + cash payments only (card and transfer excluded)',
    closed.expected_cash.equals(cash) && closed.difference.equals(0), `expected=${closed.expected_cash} cash=${cash}`);

  const late = await world.sell(world.saleDto(variants.slice(5, 6), { occurred_at: new Date(Date.now() + 1000).toISOString(), payments: [{ method: 'cash', amount: 50 }, { method: 'card', amount: 64 }] }));
  const reconciled = await prisma.shift.findUniqueOrThrow({ where: { id: world.shift.id } });
  check('P4 a late sale moves the closed shift by its cash payments only', late.warning_codes.includes('LATE_SYNC') && reconciled.expected_cash.equals(cash.plus(50)), `expected=${reconciled.expected_cash}`);
}

// --- X ------------------------------------------------------------------------

async function verifyDiscounts() {
  const world = await createSalesWorld(prisma, 'x');
  const [a, b, c] = [await world.createVariant(), await world.createVariant(), await world.createVariant()];
  await world.sell(world.saleDto([a])); // warm caches
  const dto = (items, extra = {}) => {
    const sale = world.saleDto([a], extra);
    return { ...sale, items };
  };
  const item = (variant, extra = {}) => ({ variant_id: variant.id, qty: 2, unit_price: 100, unit_tax: 14, sku_snapshot: variant.sku, name_ar_snapshot: 'صنف', ...extra });

  // 10% on a 2 x 100 line: net 180, tax 25.20, total 205.20.
  const [tenth, statements] = await counted(() => world.sell(dto([item(a, { discount: { type: 'percent', value: 10 } })], { local_total: 205.2, payments: [{ method: 'cash', amount: 205.2 }] })));
  const stored = await prisma.salesInvoiceItem.findFirstOrThrow({ where: { sales_invoice_id: tenth.id } });
  check('X1 a line discount is stored with the tax after it (discount 20.00, tax 25.20)', stored.discount_amount.equals(20) && stored.tax_amount.equals('25.2') && stored.unit_price.equals(100) && stored.unit_tax.equals(14), `${stored.discount_amount} ${stored.tax_amount}`);
  check('X1 the invoice totals add up (300... 200 - 20 + 25.20 = 205.20) with no mismatch warning',
    tenth.subtotal.equals(200) && tenth.discount_amount.equals(20) && tenth.tax_amount.equals('25.2') && tenth.total.equals('205.2') && !tenth.warning_codes.includes('LOCAL_TOTAL_MISMATCH'),
    `${tenth.subtotal} ${tenth.discount_amount} ${tenth.tax_amount} ${tenth.total} ${show(tenth.warning_codes)}`);
  check('X1 a discount adds no statements', statements === SALE_STATEMENTS, `got ${statements}`);
  const snapshot = await prisma.salesTaxSnapshot.findFirstOrThrow({ where: { sales_invoice_id: tenth.id } });
  check('X2 the tax snapshot base is the discounted net (180) and its tax 25.20', snapshot.base_amount.equals(180) && snapshot.tax_amount.equals('25.2'), `${snapshot.base_amount} ${snapshot.tax_amount}`);
  check('X3 a discount at the cashier limit is not flagged', !tenth.warning_codes.includes('DISCOUNT_ABOVE_LIMIT'));

  const half = await world.sell(dto([item(a, { discount: { type: 'percent', value: 50 } })], { local_total: 114, payments: [{ method: 'cash', amount: 114 }] }));
  check('X3 a 50% discount by a cashier is accepted with DISCOUNT_ABOVE_LIMIT', half.warning_codes.includes('DISCOUNT_ABOVE_LIMIT') && half.total.equals(114), show(half.warning_codes));

  // Invoice discount of 30 over three lines of 200 net each: 10 each; the lines keep 10 + 10 + 10.
  const spread = await world.sell(dto([item(a), item(b), item(c)], { discount: { type: 'amount', value: 30 }, local_total: 6 * 100 * 1.14 - 34.2, payments: [{ method: 'cash', amount: 6 * 100 * 1.14 - 34.2 }] }));
  const rows = await prisma.salesInvoiceItem.findMany({ where: { sales_invoice_id: spread.id } });
  const shares = rows.map((row) => String(row.discount_amount)).sort();
  check('X4 an invoice discount is spread over the lines and adds up to the invoice discount',
    shares.join() === '10,10,10' && spread.discount_amount.equals(30) && spread.total.equals('649.8'), `${shares.join()} total=${spread.total}`);

  // Two lines of one variant with different discounts become one row, not a refusal.
  const merged = await world.sell(dto([item(a, { qty: 1, discount: { type: 'amount', value: 10 } }), item(a, { qty: 1 })], { local_total: 216.6, payments: [{ method: 'cash', amount: 216.6 }] }));
  const mergedRows = await prisma.salesInvoiceItem.findMany({ where: { sales_invoice_id: merged.id } });
  check('X5 two lines of one variant with different discounts merge into one row', mergedRows.length === 1 && mergedRows[0].qty.equals(2) && mergedRows[0].discount_amount.equals(10), show(mergedRows.map((row) => String(row.discount_amount))));

  const sale = dto([item(a, { discount: { type: 'percent', value: 10 } })], { local_total: 205.2, payments: [{ method: 'cash', amount: 205.2 }] });
  const first = await world.sell(sale);
  const replay = await world.sell(sale);
  const changed = await rejection(world.sell({ ...sale, items: [item(a, { discount: { type: 'percent', value: 20 } })] }));
  check('X6 a replay is idempotent and the same sync_id with another discount is a context conflict', replay.id === first.id && changed?.response?.code === 'SALE_IDEMPOTENCY_CONTEXT_CONFLICT', changed?.message);
}

// --- C ------------------------------------------------------------------------

async function verifyCredit() {
  const world = await createSalesWorld(prisma, 'c');
  const other = await createSalesWorld(prisma, 'c-other');
  const [variant] = [await world.createVariant()];
  await world.sell(world.saleDto([variant])); // warm caches
  const CustomerAccountsService = load('customers', 'customer-accounts.service.js', 'CustomerAccountsService');
  const accounts = new CustomerAccountsService(prisma);
  const actor = { sub: world.cashier.id, membership_role: 'tenant_owner', permissions: new Set(), scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }] };
  const phone = '01077777001';
  const creditSale = (extra = {}) => world.saleDto([variant], { customer_phone: phone, local_total: 114, payments: [{ method: 'credit', amount: 114 }], ...extra });

  const [first, statements] = await counted(() => world.sell(creditSale()));
  const customer = await prisma.customer.findFirstOrThrow({ where: { tenant_id: world.tenant.id, phone } });
  const entries = await prisma.customerLedgerEntry.findMany({ where: { customer_id: customer.id } });
  check('C1 a credit sale puts its amount on the customer and one ledger entry explains it',
    customer.balance.equals(114) && entries.length === 1 && entries[0].type === 'sale_credit' && entries[0].amount.equals(114) && entries[0].balance_after.equals(114) && entries[0].sales_invoice_id === first.id,
    `balance=${customer.balance} entries=${entries.length}`);
  check(`C1 a credit sale for a customer costs ${SALE_STATEMENTS + 2} statements (17 + customer + ledger)`, statements === SALE_STATEMENTS + 2, `got ${statements}`);
  const [, plainWithCustomer] = await counted(() => world.sell(world.saleDto([variant], { customer_phone: phone })));
  check('C1 a sale to the same customer without credit costs 18: no ledger statement', plainWithCustomer === SALE_STATEMENTS + 1, `got ${plainWithCustomer}`);
  const replayDto = creditSale();
  await world.sell(replayDto);
  await world.sell(replayDto);
  const afterReplay = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  check('C1 replaying a credit sale does not book it twice', afterReplay.balance.equals(228), `balance=${afterReplay.balance}`);

  await accounts.setCreditLimit(world.context, customer.id, 300);
  const over = await world.sell(creditSale());
  check('C2 a credit sale beyond the limit is accepted with CUSTOMER_CREDIT_LIMIT_EXCEEDED', over.warning_codes.includes('CUSTOMER_CREDIT_LIMIT_EXCEEDED') && over.total.equals(114), show(over.warning_codes));
  const noCustomer = await world.sell(world.saleDto([variant], { local_total: 114, payments: [{ method: 'credit', amount: 114 }] }));
  check('C2 credit without a customer is accepted with CREDIT_WITHOUT_CUSTOMER', noCustomer.warning_codes.includes('CREDIT_WITHOUT_CUSTOMER'));

  // Collecting a debt.
  const collect = (extra = {}) => accounts.collectPayment(world.context, customer.id, { amount: 100, method: 'cash', idempotency_key: randomUUID(), shift_id: world.shift.id, ...extra }, actor);
  const key = randomUUID();
  const paid = await collect({ idempotency_key: key });
  const again = await collect({ idempotency_key: key });
  const reused = await rejection(collect({ idempotency_key: key, amount: 50 }));
  const owed = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  check('C3 a collection lowers the balance once; the same key replays, another amount is a conflict',
    paid.balance_after === '242' && again.replayed === true && again.id === paid.id && reused?.response?.code === 'IDEMPOTENCY_KEY_REUSED' && owed.balance.equals(242), `${paid.balance_after} ${again.replayed} ${owed.balance}`);
  await collect({ amount: 40, method: 'card', shift_id: undefined });

  const sum = (await prisma.customerLedgerEntry.aggregate({ where: { customer_id: customer.id }, _sum: { amount: true } }))._sum.amount;
  const afterAll = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  check('C4 the balance always equals the sum of the ledger', afterAll.balance.equals(sum), `${afterAll.balance} vs ${sum}`);

  await Promise.all(Array.from({ length: 10 }, () => collect({ amount: 1, method: 'cash' })));
  const concurrent = await prisma.customerLedgerEntry.findMany({ where: { customer_id: customer.id, type: 'payment' } });
  const balances = new Set(concurrent.map((entry) => String(entry.balance_after)));
  const final = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
  check('C4 ten concurrent collections each record the balance they produced (no lost update)', balances.size === concurrent.length && final.balance.equals(afterAll.balance.minus(10)), `${balances.size}/${concurrent.length} final=${final.balance}`);

  // The shift: cash collected at its till (100 + 10 x 1) counts, the card payment does not.
  const ShiftsService = load('shifts', 'shifts.service.js', 'ShiftsService');
  const ShiftsRepository = load('shifts', 'shifts.repository.js', 'ShiftsRepository');
  const cashSales = (await prisma.salesPayment.aggregate({ where: { tenant_id: world.tenant.id, method: 'cash' }, _sum: { amount: true } }))._sum.amount ?? D(0);
  await new ShiftsService(prisma, new ShiftsRepository(prisma)).close(world.context, world.shift.id, actor, 0);
  const closed = await prisma.shift.findUniqueOrThrow({ where: { id: world.shift.id } });
  check('C5 cash collected in a shift is part of its expected cash (card is not)', closed.expected_cash.equals(cashSales.plus(110)), `expected=${closed.expected_cash} cashSales=${cashSales}`);

  const rewrite = await rejection(prisma.$executeRaw`UPDATE "CustomerLedgerEntry" SET "note" = 'x' WHERE "customer_id" = ${customer.id}::uuid`);
  const wipe = await rejection(prisma.$executeRaw`DELETE FROM "CustomerLedgerEntry" WHERE "customer_id" = ${customer.id}::uuid`);
  check('C6 the ledger is append-only', rewrite !== null && wipe !== null);

  const debtors = await accounts.debtors(world.context);
  check('C7 the debtors list shows who owes and the total', debtors.items.some((row) => row.id === customer.id) && debtors.total_owed.equals(final.balance), `total_owed=${debtors.total_owed}`);
  const ledgerCount = await prisma.customerLedgerEntry.count({ where: { customer_id: customer.id } });
  const page = await accounts.statement(world.context, customer.id, { page: 1, page_size: 5 });
  check('C7 the statement pages the ledger newest first with the customer balance', page.items.length === 5 && page.total === ledgerCount && page.customer.balance.equals(final.balance), `total=${page.total}/${ledgerCount}`);
  const stranger = await rejection(accounts.collectPayment(other.context, customer.id, { amount: 1, method: 'cash', idempotency_key: randomUUID() }, actor));
  const noStatement = await rejection(accounts.statement(other.context, customer.id));
  check('C8 another tenant cannot collect from or read this customer', stranger?.status === 404 && noStatement?.status === 404);
}

// --- main -----------------------------------------------------------------------

async function main() {
  const sections = [verifyDocumentSequences, verifyNeverRefused, verifyPayments, verifyDiscounts, verifyCredit];
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
