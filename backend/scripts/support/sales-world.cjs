// Real-Postgres fixture for the W3 sales checks: a tenant with a branch, tax code,
// price book, enrolled terminal, cashier, seller, open shift and stocked variants,
// plus the real SalesService built from the compiled code. Requires `npm run build`.
'use strict';

const path = require('node:path');
const { randomUUID } = require('crypto');
const { Prisma } = require('@prisma/client');

const dist = (...segments) => path.join(__dirname, '..', '..', 'dist', 'src', ...segments);
const D = (value) => new Prisma.Decimal(value);

function loadServices() {
  try {
    return {
      InventoryService: require(dist('inventory', 'inventory.service.js')).InventoryService,
      InventoryRepository: require(dist('inventory', 'inventory.repository.js')).InventoryRepository,
      SalesService: require(dist('sales', 'sales.service.js')).SalesService,
      BranchesRepository: require(dist('branches', 'branches.repository.js')).BranchesRepository,
      PricingService: require(dist('pricing', 'pricing.service.js')).PricingService,
      TaxResolutionService: require(dist('tax', 'tax-resolution.service.js')).TaxResolutionService,
      SalesTaxSnapshotService: require(dist('tax', 'sales-tax-snapshot.service.js')).SalesTaxSnapshotService,
    };
  } catch (error) {
    console.error(`Could not load compiled services from dist/ (run \`npm run build\` first): ${error?.message ?? error}`);
    process.exit(1);
  }
}

/** Counts the SQL statements a function issues (BEGIN/COMMIT excluded). */
function statementCounter(prisma) {
  let capture = null;
  prisma.$on('query', (event) => {
    if (!capture) return;
    const sql = event.query.trim().toUpperCase();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql.startsWith('SAVEPOINT')) return;
    capture.push(event.query);
  });
  return async function counted(fn) {
    capture = [];
    try {
      const result = await fn();
      return [result, capture.length];
    } finally {
      capture = null;
    }
  };
}

async function createSalesWorld(prisma, label, options = {}) {
  const services = loadServices();
  const inventory = new services.InventoryService(new services.InventoryRepository(prisma));
  const tenant = await prisma.tenant.create({ data: { name: `w3-${label}-${randomUUID()}`, default_currency: 'EGP' } });
  const context = { tenantId: tenant.id };
  const branch = await new services.BranchesRepository(prisma).save(context, { code: `W-${randomUUID().slice(0, 8)}`, name_ar: `فرع ${label}` });
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { tenant_id: tenant.id, branch_id: branch.id, is_default: true } });
  const taxCategory = await prisma.taxCategory.create({ data: { tenant_id: tenant.id, code: 'STANDARD', name_en: 'Standard', updated_at: new Date() } });
  await prisma.taxCode.create({
    data: {
      tenant_id: tenant.id, tax_category_id: taxCategory.id, code: 'STANDARD', name_en: 'Standard rate', jurisdiction: 'EG',
      calculation_method: 'percentage', rate: D('14.0000'), tax_mode: 'exclusive', rounding_policy: 'line',
      version: 1, status: 'active', activated_at: new Date(), updated_at: new Date(),
    },
  });
  const book = await prisma.priceBook.create({ data: { tenant_id: tenant.id, name: 'W3 book', currency: 'EGP', status: 'active', is_default: true } });
  await prisma.priceBookEntry.create({
    data: { tenant_id: tenant.id, price_book_id: book.id, scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 100, allow_zero_price: false, tax_mode: 'exclusive', effective_from: new Date(0), status: 'active' },
  });
  const terminal = await prisma.posTerminal.create({
    data: { tenant_id: tenant.id, device_id: randomUUID(), terminal_code: `POS${options.terminalNumber ?? 1}`, name: 'Till', branch_id: branch.id },
  });
  const staff = async (role, name) => {
    const user = await prisma.user.create({ data: { name, password_hash: 'not-a-real-hash' } });
    await prisma.membership.create({
      data: {
        tenant_id: tenant.id, user_id: user.id, role, status: 'active',
        access_scope_assignments: { create: { scope_type: 'location', scope_ref_id: branch.id, grant_source: 'verify' } },
      },
    });
    return user;
  };
  const cashier = await staff('cashier', 'Cashier');
  const seller = await staff('seller', 'Seller');
  const shift = await prisma.shift.create({ data: { tenant_id: tenant.id, branch_id: branch.id, opened_by: cashier.id } });
  const sales = new services.SalesService(
    prisma,
    new services.PricingService(prisma, new services.TaxResolutionService(prisma)),
    { canViewSaleCostMargin: async () => false },
    new services.SalesTaxSnapshotService(),
    inventory,
  );
  const world = { tenant, context, branch, warehouse, taxCategory, terminal, cashier, seller, shift, sales, inventory, sequence: 0 };

  world.createVariant = async (overrides = {}) => {
    const product = await prisma.product.create({ data: { tenant_id: tenant.id, name_en: `W3 product ${randomUUID()}`, tax_category_id: taxCategory.id, is_active: true } });
    return prisma.productVariant.create({
      data: { tenant_id: tenant.id, product_id: product.id, sku: `W3-${randomUUID().slice(0, 8)}`, cost_price: D(60), is_active: true, ...overrides },
    });
  };
  world.terminalRow = { id: terminal.id, branch_id: branch.id, tenant_id: tenant.id };

  /** A POS sale command at price 100 + 14 tax per unit unless a line says otherwise. */
  world.saleDto = (variants, overrides = {}) => {
    world.sequence += 1;
    const items = variants.map((variant) => ({
      variant_id: variant.id, qty: 1, unit_price: 100, unit_tax: 14,
      sku_snapshot: variant.sku, name_ar_snapshot: 'صنف', name_en_snapshot: 'Item',
    }));
    return {
      event_version: 2, sync_id: randomUUID(), branch_id: branch.id, shift_id: shift.id, origin_cashier_id: cashier.id,
      cashier_name_snapshot: 'Cashier', seller_id: seller.id, seller_name_snapshot: 'Seller', offline_session_id: randomUUID(),
      terminal_sequence: String(world.sequence), invoice_number: `POS${options.terminalNumber ?? 1}-${String(world.sequence).padStart(6, '0')}`,
      occurred_at: new Date().toISOString(), items, language: 'ar',
      payment_method: 'cash', local_total: 114 * items.length,
      ...overrides,
    };
  };
  world.sell = (dto) => sales.createSale(dto, world.terminalRow);
  return world;
}

module.exports = { createSalesWorld, statementCounter, D };
