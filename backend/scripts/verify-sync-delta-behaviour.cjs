#!/usr/bin/env node
// W2a -- real-Postgres proof of the sync redesign (run by `npm run test:db`;
// needs `npm run build` first because it drives the compiled services).
//
// Proves:
//   D1 delta-by-entity: changing one product/barcode/price/stock row sends
//      only that entity -- no catalog reload, no sellers/settings unless changed.
//   D2 a wide change (a global price entry) restarts the snapshot.
//   D3 a late commit is never skipped: a transaction that got its id first but
//      writes/commits last is delivered on a later pull, even though its change
//      has a higher sequence than changes already handed out.
//   D4 compaction removes what every active till has applied, and a till
//      behind the floor is told to take a fresh snapshot.
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const dist = (...parts) => require(path.join(__dirname, '..', 'dist', 'src', ...parts));
const { SyncService } = dist('sync', 'sync.service.js');
const { SyncCompactionService } = dist('sync', 'sync-compaction.service.js');
const { PricingService } = dist('pricing', 'pricing.service.js');
const { TaxResolutionService } = dist('tax', 'tax-resolution.service.js');
const { InventoryService } = dist('inventory', 'inventory.service.js');
const { InventoryRepository } = dist('inventory', 'inventory.repository.js');

const prisma = new PrismaClient();
let failed = 0;

function check(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` -- ${detail}`}\n`);
}
const same = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

async function seed() {
  const tenant = await prisma.tenant.create({ data: { name: `sync-delta-verify-${randomUUID()}` } });
  const tenant_id = tenant.id;
  const branch = await prisma.branch.create({ data: { tenant_id, code: `D-${randomUUID().slice(0, 8)}`, name_ar: 'فرع' } });
  const warehouse = await prisma.warehouse.create({ data: { tenant_id, branch_id: branch.id, name: 'Default', is_default: true } });
  const category = await prisma.taxCategory.create({ data: { tenant_id, code: 'STANDARD', name_en: 'Standard', updated_at: new Date() } });
  await prisma.taxCode.create({
    data: {
      tenant_id, tax_category_id: category.id, code: 'STANDARD', name_en: 'Standard', jurisdiction: 'EG',
      calculation_method: 'percentage', rate: 14, tax_mode: 'exclusive', rounding_policy: 'line', version: 1,
      status: 'active', activated_at: new Date(), updated_at: new Date(),
    },
  });
  const book = await prisma.priceBook.create({
    data: { tenant_id, name: 'Book', currency: 'EGP', status: 'active', is_default: true },
  });
  const globalEntry = await prisma.priceBookEntry.create({
    data: {
      tenant_id, price_book_id: book.id, scope_type: 'global', min_qty: 1, unit_price: 100, allow_zero_price: false,
      tax_mode: 'exclusive', effective_from: new Date(0), status: 'active',
    },
  });
  const products = [];
  for (let i = 0; i < 3; i++) {
    const product = await prisma.product.create({
      data: {
        tenant_id, name_en: `Delta product ${i}`, tax_category_id: category.id,
        variants: { create: [{ sku: `D-${randomUUID().slice(0, 8)}`, cost_price: 10, label: `L${i}`, attributes: { n: i } }] },
      },
      include: { variants: true },
    });
    products.push({ ...product, variant: product.variants[0] });
  }
  return { tenant, branch, warehouse, book, globalEntry, products };
}

async function main() {
  const { tenant, branch, warehouse, globalEntry, products } = await seed();
  const tax = new TaxResolutionService(prisma);
  const service = new SyncService(prisma, new PricingService(prisma, tax), tax, new InventoryService(new InventoryRepository(prisma)));
  const context = { tenantId: tenant.id };
  const [a, b, c] = products;
  const ids = (page) => page.products.map((p) => p.id).sort();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  // A snapshot; its cursor is the head of the finished changes.
  let page = await service.pull(context, branch.id);
  same('D0 the snapshot has every variant, in one page', ids(page), products.map((p) => p.variant.id).sort());
  let cursor = page.cursor;
  const isEmpty = (r) =>
    r.mode === 'delta' && !r.products.length && !r.stock.length && !r.deleted_variant_ids.length && !('sellers' in r);
  // A change becomes visible once every older transaction in the cluster has finished
  // (other sessions on this database server can delay that briefly), so wait for it.
  const delta = async (expectChange = true) => {
    let result;
    for (let attempt = 0; attempt < 40; attempt++) {
      result = await service.pull(context, branch.id, { cursor });
      if (!expectChange || !isEmpty(result)) break;
      await settle();
    }
    cursor = result.cursor;
    return result;
  };
  // Changes made while seeding are finished but not yet behind the cursor: drain them.
  await delta(false);
  same('D0 nothing is pending right after the snapshot', ids(await delta(false)), []);

  // D1 -- one entity at a time
  await prisma.product.update({ where: { id: a.id }, data: { name_en: 'Renamed A' } });
  let d = await delta();
  same('D1 a renamed product sends only its own variant', ids(d), [a.variant.id]);
  check('D1 ...and no sellers or settings', !('sellers' in d) && !('settings' in d));

  await prisma.productBarcode.create({ data: { tenant_id: tenant.id, code: `BC-${randomUUID()}`, variant_id: b.variant.id, pack_qty: 6 } });
  d = await delta();
  same('D1 a new barcode sends its variant', ids(d), [b.variant.id]);
  same('D1 ...with the pack quantity', d.products[0].barcodes.map((x) => x.pack_qty), [6]);

  await prisma.inventoryStock.create({
    data: { tenant_id: tenant.id, warehouse_id: warehouse.id, variant_id: c.variant.id, qty_on_hand: 2.5 },
  });
  d = await delta();
  same('D1 a stock change sends only that stock row', d.stock.map((s) => [s.variant_id, s.qty_on_hand]), [[c.variant.id, 2.5]]);
  same('D1 ...and no product rows for an unchanged catalog', d.products.length, 0);

  await prisma.priceBookEntry.create({
    data: {
      tenant_id: tenant.id, price_book_id: globalEntry.price_book_id, scope_type: 'variant', scope_id: b.variant.id,
      min_qty: 1, unit_price: 55, allow_zero_price: false, tax_mode: 'exclusive', effective_from: new Date(0), status: 'active',
    },
  });
  d = await delta();
  same('D1 a variant price sends only that variant', ids(d), [b.variant.id]);
  check('D1 ...at the new net price', d.products[0].selling_price === 55, String(d.products[0]?.selling_price));

  await prisma.productVariant.update({ where: { id: c.variant.id }, data: { is_active: false } });
  d = await delta();
  same('D1 a deactivated variant is reported as deleted', d.deleted_variant_ids, [c.variant.id]);

  const user = await prisma.user.create({ data: { name: 'Seller', phone: `+2010${Date.now() % 100000000}`, password_hash: 'x' } });
  const membership = await prisma.membership.create({ data: { tenant_id: tenant.id, user_id: user.id, role: 'seller', status: 'active' } });
  await prisma.accessScopeAssignment.create({
    data: { membership_id: membership.id, scope_type: 'location', scope_ref_id: branch.id, grant_source: 'verify' },
  });
  d = await delta();
  same('D1 a new seller sends the seller list', (d.sellers || []).map((s) => s.name), ['Seller']);
  same('D1 sellers are not repeated once delivered', 'sellers' in (await delta(false)), false);

  // D2 -- a wide change restarts the snapshot
  await prisma.priceBookEntry.update({ where: { id: globalEntry.id }, data: { unit_price: 120 } });
  d = await delta();
  check('D2 a global price change restarts the snapshot', d.mode === 'snapshot' && d.reset_products === true);

  // D3 -- a late commit is never skipped
  cursor = (await service.pull(context, branch.id)).cursor;
  let started;
  const hasStarted = new Promise((resolve) => (started = resolve));
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  // T1 gets its transaction id first but writes (and commits) last.
  const late = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_current_xact_id()::text`;
      started();
      await gate;
      await tx.product.update({ where: { id: a.id }, data: { name_en: 'Late A' } });
    },
    { timeout: 60_000, maxWait: 60_000 },
  );
  await hasStarted;
  await prisma.product.update({ where: { id: b.id }, data: { name_en: 'Early B' } });
  const before = await service.pull(context, branch.id, { cursor });
  same('D3 while an older transaction is open, later commits are held back', ids(before), []);
  release();
  await late;
  await settle();
  const after = await service.pull(context, branch.id, { cursor });
  same('D3 once it commits, both changes arrive (nothing skipped)', ids(after), [a.variant.id, b.variant.id].sort());

  // D4 -- compaction and the floor
  const applied = after.cursor;
  await prisma.$executeRaw`UPDATE "SyncChange" SET "created_at" = now() - interval '3 days' WHERE "tenant_id" = ${tenant.id}::uuid`;
  await prisma.posTerminal.create({
    data: {
      tenant_id: tenant.id, branch_id: branch.id, device_id: randomUUID(), terminal_code: 'T1', name: 'T1',
      last_seen_at: new Date(), sync_cursor: applied,
    },
  });
  await prisma.product.update({ where: { id: c.id }, data: { name_en: 'After compaction cutoff' } });
  const result = await new SyncCompactionService(prisma).compact(30);
  check('D4 compaction deleted what the till had applied', result.deleted > 0, JSON.stringify(result));
  const left = await prisma.syncChange.count({ where: { tenant_id: tenant.id } });
  check('D4 ...and kept the newer change', left >= 1, `left=${left}`);
  const stale = await service.pull(context, branch.id, { cursor: '1:1' });
  check('D4 a till behind the floor is told to take a fresh snapshot', stale.mode === 'snapshot' && stale.reset_products === true);
  const current = await service.pull(context, branch.id, { cursor: applied });
  check('D4 a till at the applied cursor still gets a delta', current.mode === 'delta');

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll sync delta behaviour checks passed\n');
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
