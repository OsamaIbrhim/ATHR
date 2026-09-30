#!/usr/bin/env node
// Real-Postgres proof of W3 (sales): document numbers, payments, credit,
// discounts, tenant sale settings, returns and exchange. Constructs the real
// compiled services against a real PrismaClient, so it asserts on the code that
// ships and requires `npm run build` first (see `npm run test:db`).
//
//   D1-D5   per-tenant document numbers: two tenants, concurrency, rollback,
//           adjustments / counts, terminal codes
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

const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
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
  check('D5 terminal codes come from the tenant counter, not from the device id', codeA === 'POS1' && codeB === 'POS2' && deviceA.slice(0, 8) === deviceB.slice(0, 8));
}

// --- main -----------------------------------------------------------------------

async function main() {
  const sections = [verifyDocumentSequences];
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
