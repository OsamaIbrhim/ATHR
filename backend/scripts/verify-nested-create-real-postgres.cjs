#!/usr/bin/env node
// WP-009 Phase 0.5 -- real-Postgres proof that Prisma nested `create`s under
// a parent whose child shares a composite tenant_id FK actually succeed
// against a real database, not merely a fakePrisma mock.
//
// The class of bug this guards: a nested `create` (`parent.create({ data: {
// ..., childRelation: { create: [...] } } })`) where the child model shares
// a composite FK on (tenant_id, parent_id) with the parent. Prisma's codegen
// excludes both composite-FK columns from that nested-create's input type
// and auto-fills them from the parent -- passing tenant_id explicitly is
// rejected at runtime with `PrismaClientValidationError: Unknown argument
// tenant_id`, unconditionally, before any SQL is sent. TypeScript does not
// reliably catch this: in `receive()` the object literal was built inside
// `.map()`, so the excess-property check never fired across that inference
// boundary; in `sellers.repository.ts`'s `savePeriod()` someone silenced it
// by hand with `as any`.
//
// This class survived every existing test for the same reason in both
// cases: fakePrisma-backed jest specs (`purchasing.service.spec.ts`,
// `purchasing.cross-tenant.spec.ts`, `sellers.service.spec.ts`) never
// validate argument shape -- they accept and echo back whatever `data`
// object is passed. `prisma/seed.ts` and `perf/purchasing-accounting-
// smoke.mjs` build their fixtures with the correct (tenant_id-omitting)
// shape or bypass `receive()` entirely, so neither ever exercises the buggy
// shape. Nothing in this repository called `receive()` or
// `closePeriod()`/`savePeriod()` against a real database before this
// script. This script closes that gap by constructing the real compiled
// service classes against a real PrismaClient and calling them end to end,
// the same convention as verify-raw-sql-tenant-scoping.cjs.
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const distPurchasing = path.join(__dirname, '..', 'dist', 'src', 'purchasing', 'purchasing.service.js');
const distSellersService = path.join(__dirname, '..', 'dist', 'src', 'sellers', 'sellers.service.js');
const distSellersRepository = path.join(__dirname, '..', 'dist', 'src', 'sellers', 'sellers.repository.js');
const distInventoryService = path.join(__dirname, '..', 'dist', 'src', 'inventory', 'inventory.service.js');
const distInventoryRepository = path.join(__dirname, '..', 'dist', 'src', 'inventory', 'inventory.repository.js');

let PurchasingService, SellersService, SellersRepository, InventoryService, InventoryRepository;
try {
  ({ PurchasingService } = require(distPurchasing));
  ({ SellersService } = require(distSellersService));
  ({ SellersRepository } = require(distSellersRepository));
  ({ InventoryService } = require(distInventoryService));
  ({ InventoryRepository } = require(distInventoryRepository));
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
  const branch = await prisma.branch.create({
    data: { tenant_id: tenantId, code: `${label}-${randomUUID().slice(0, 8)}`, name_ar: 'فرع الفحص' },
  });
  // A branch's stock lives in its default warehouse.
  await prisma.warehouse.create({
    data: { tenant_id: tenantId, branch_id: branch.id, name: `${label} default`, is_default: true },
  });
  return branch;
}

async function createTaxCategory(tenantId) {
  return prisma.taxCategory.create({
    data: { tenant_id: tenantId, code: 'STANDARD', name_en: 'Standard' },
  });
}

async function createVariant(tenantId, taxCategory) {
  const product = await prisma.product.create({
    data: {
      tenant_id: tenantId,
      name_en: `Verify product ${randomUUID()}`,
      tax_category_id: taxCategory.id,
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
    },
  });
}

async function createSupplier(tenantId, label) {
  return prisma.supplier.create({
    data: { tenant_id: tenantId, name: `Verify supplier ${label}-${randomUUID().slice(0, 8)}` },
  });
}

async function createOwnerUser() {
  return prisma.user.create({
    data: { name: 'Verify owner', password_hash: 'not-a-real-hash' },
  });
}

async function createSellerWithMembership(tenantId) {
  const seller = await prisma.user.create({
    data: { name: 'Verify seller', password_hash: 'not-a-real-hash' },
  });
  await prisma.membership.create({
    data: { tenant_id: tenantId, user_id: seller.id, role: 'seller', status: 'active' },
  });
  return seller;
}

// --- N1: PurchasingService.receive() -- purchasing.service.ts:167-203 -------
// The disclosed instance: nested PurchaseInvoiceItem create under
// PurchaseInvoice, sharing a composite (tenant_id, purchase_invoice_id) FK.

async function verifyReceiveAgainstRealPostgres() {
  const tenant = await createTenant('wp0905-n1');
  const branch = await createBranch(tenant.id, 'n1');
  const supplier = await createSupplier(tenant.id, 'n1');
  const taxCategory = await createTaxCategory(tenant.id);
  const variant = await createVariant(tenant.id, taxCategory);
  const owner = await createOwnerUser();
  const service = new PurchasingService(prisma, new InventoryService(new InventoryRepository(prisma)));
  const context = { tenantId: tenant.id };
  const actor = { sub: owner.id, membership_role: 'tenant_owner', permissions: new Set(), scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }] };

  let invoice = null;
  let caught = null;
  try {
    invoice = await service.receive(
      context,
      {
        command_id: randomUUID(),
        supplier_id: supplier.id,
        branch_id: branch.id,
        items: [{ variant_id: variant.id, qty: 5, unit_cost: 10 }],
      },
      actor,
    );
  } catch (error) {
    caught = error;
  }

  expectTrue(
    'N1 receive() succeeds end to end against real Postgres',
    caught === null,
    caught ? `${caught.constructor?.name ?? 'Error'}: ${caught.message}` : undefined,
  );
  if (invoice) {
    expectTrue(
      'N1 receive() creates exactly one item with tenant_id inherited from the parent',
      invoice.items?.length === 1 && invoice.items[0].tenant_id === tenant.id,
      `items=${JSON.stringify(invoice.items?.map((i) => ({ tenant_id: i.tenant_id })))}`,
    );
  }
}

// --- N2: SellersService.closePeriod() -- sellers.service.ts:147-199 ---------
// The newly found instance: nested SellerCommissionPeriodRow create under
// SellerCommissionPeriod, sharing a composite (tenant_id, period_id) FK.

async function verifyClosePeriodAgainstRealPostgres() {
  const tenant = await createTenant('wp0905-n2');
  await createSellerWithMembership(tenant.id);
  const owner = await createOwnerUser();
  const service = new SellersService(new SellersRepository(prisma));
  const context = { tenantId: tenant.id };
  const actor = { sub: owner.id, membership_role: 'tenant_owner', permissions: new Set(), scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }] };

  let period = null;
  let caught = null;
  try {
    period = await service.closePeriod(context, '2026-01-01', '2026-01-31', actor);
  } catch (error) {
    caught = error;
  }

  expectTrue(
    'N2 closePeriod() succeeds end to end against real Postgres',
    caught === null,
    caught ? `${caught.constructor?.name ?? 'Error'}: ${caught.message}` : undefined,
  );
  if (period) {
    expectTrue(
      'N2 closePeriod() creates exactly one row with tenant_id inherited from the parent',
      period.rows?.length === 1 && period.rows[0].tenant_id === tenant.id,
      `rows=${JSON.stringify(period.rows?.map((r) => ({ tenant_id: r.tenant_id })))}`,
    );
  }
}

async function main() {
  await verifyReceiveAgainstRealPostgres();
  await verifyClosePeriodAgainstRealPostgres();

  process.stdout.write(failed ? `\n${failed} check(s) FAILED\n` : '\nAll nested-create real-Postgres checks passed\n');
  if (failed) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
