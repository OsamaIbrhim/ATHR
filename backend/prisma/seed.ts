import { MembershipRole, PrismaClient } from '@prisma/client';
import * as bcryptjs from 'bcryptjs';
import { ensureActiveSubscription, seedPlans } from './seed/plans';
import { InventoryRepository } from '../src/inventory/inventory.repository';
import { InventoryService } from '../src/inventory/inventory.service';
import { applyPreset } from '../src/catalog/presets';

const prisma = new PrismaClient();
// The seed writes stock through the same single writer as the application.
const inventory = new InventoryService(new InventoryRepository(prisma as any));
let randomState = 0x1a2b3c4d;

function deterministicRandom() {
  randomState = (1664525 * randomState + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

async function main() {
  console.log('🌱 Seeding Bold POS – Test Data v2.1 – Full with line items …');

  // Clean – reverse FK order
  await prisma.returnItem.deleteMany();
  await prisma.return.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.posTerminal.deleteMany();
  // WP-008 Phase C: snapshots cascade from their invoice, but they are
  // cleared explicitly first so the reverse-FK order below stays readable as
  // the dependency order it documents.
  await prisma.salesTaxSnapshot.deleteMany();
  await prisma.salesInvoiceItem.deleteMany();
  await prisma.salesInvoice.deleteMany();
  await prisma.purchaseInvoiceItem.deleteMany();
  await prisma.purchaseInvoice.deleteMany();
  await prisma.transferItem.deleteMany();
  await prisma.transfer.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM "Shift"');
  await prisma.inventoryStock.deleteMany();
  await prisma.offerSuggestion.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productType.deleteMany();
  // After Product/ProductVariant (both hold onDelete: Restrict FKs to
  // TaxCategory) and before Customer (TaxExemption restricts on it).
  await prisma.taxExemption.deleteMany();
  await prisma.taxCode.deleteMany();
  await prisma.taxCategory.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.priceBookEntry.deleteMany();
  await prisma.priceBook.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.accessScopeAssignment.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.category.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.branch.deleteMany();

  // WP-007 Phase A: every seeded row belongs to a Tenant, and every seeded
  // user gets a Membership. Without this the global TenantContextGuard denies
  // every request from a seeded account — the API boots but nobody can log in
  // and do anything.
  const tenant =
    (await prisma.tenant.findFirst({ where: { name: 'Initial ATHR Demo Tenant' } })) ??
    (await prisma.tenant.create({ data: { name: 'Initial ATHR Demo Tenant' } }));
  const tenant_id = tenant.id;

  // Plans are data; the demo tenant runs on an active Business subscription.
  await seedPlans(prisma);
  await ensureActiveSubscription(prisma, tenant_id, 'business');

  const password_hash = await bcryptjs.hash('Bold1234', 10);

  // The tenant's primary legal entity (tax / commercial-register identity).
  if (!(await prisma.legalEntity.findFirst({ where: { tenant_id, is_primary: true } }))) {
    await prisma.legalEntity.create({ data: { tenant_id, legal_name: tenant.name, is_primary: true } });
  }

  // A branch always comes with its default warehouse, which holds its stock.
  async function createBranchWithWarehouse(data: {
    code: string; name_ar: string; name_en: string; address?: string; phone?: string; cash_drawer_enabled: boolean;
  }) {
    const branch = await prisma.branch.create({ data: { tenant_id, ...data } });
    const warehouse = await prisma.warehouse.create({
      data: { tenant_id, branch_id: branch.id, name: `${branch.name_ar} — Default Warehouse`, is_default: true },
    });
    return { branch, warehouse };
  }

  // Branches
  const { branch: b1, warehouse: w1 } = await createBranchWithWarehouse({ code: 'BOLD-01', name_ar: 'بولد – الفرع الرئيسي', name_en: 'Bold Main', address: 'طنطا', phone: '0400000000', cash_drawer_enabled: false });
  const { branch: b2, warehouse: w2 } = await createBranchWithWarehouse({ code: 'BOLD-02', name_ar: 'بولد – القاهرة الجديدة', name_en: 'Bold New Cairo', cash_drawer_enabled: true });

  // Staff: a global User plus a Membership carrying the role and access scope.
  // `all` = tenant-wide scope (owner, warehouse manager); otherwise the branch.
  async function createStaff(
    data: { name: string; phone: string; email: string },
    role: MembershipRole,
    scope: 'all' | { branch_id: string },
  ) {
    return prisma.user.create({
      data: {
        ...data,
        password_hash,
        memberships: {
          create: {
            tenant_id,
            role,
            status: 'active',
            access_scope_assignments: {
              create: {
                scope_type: scope === 'all' ? 'tenant_wide' : 'location',
                scope_ref_id: scope === 'all' ? null : scope.branch_id,
                grant_source: 'seed',
              },
            },
          },
        },
      },
    });
  }

  const owner = await createStaff({ name: 'Owner – أسامة', phone: '+200100000000', email: 'owner@bold.eg' }, 'tenant_owner', 'all');
  const manager = await createStaff({ name: 'مدير فرع', phone: '+200100000001', email: 'manager@bold.eg' }, 'location_manager', { branch_id: b1.id });
  const cashier = await createStaff({ name: 'كاشير', phone: '+200100000002', email: 'cashier@bold.eg' }, 'cashier', { branch_id: b1.id });
  const warehouse = await createStaff({ name: 'أمين مخزن', phone: '+200100000003', email: 'warehouse@bold.eg' }, 'warehouse_manager', 'all');
  const seller = await createStaff({ name: 'بائع', phone: '+200100000004', email: 'seller@bold.eg' }, 'seller', { branch_id: b1.id });

  // Platform console operator (ADR-0006): no Membership, so no tenant data access.
  await prisma.user.create({
    data: {
      name: 'Platform Admin',
      phone: '+200100000099',
      email: 'platform@athr.local',
      password_hash,
      is_platform_admin: true,
    },
  });

  // Suppliers
  const s1 = await prisma.supplier.create({ data: { tenant_id, name: 'محمد', company_name: 'Mohamed Fabrics Co.', phone: '01222222222', alias_names: ['Mohamed Fabrics Co.', 'Mohamed Trading'] }});
  const s2 = await prisma.supplier.create({ data: { tenant_id, name: 'النصر', company_name: 'El-Nasr Trading', phone: '01233333333', alias_names: [] }});
  const s3 = await prisma.supplier.create({ data: { tenant_id, name: 'Classic Wear', company_name: 'Classic Wear Co.', phone: '01244444444', alias_names: ['Classic'] }});

  // Categories
  const cat_t = await prisma.category.create({ data: { tenant_id, name_ar: 'تيشيرتات', name_en: 'T-Shirts' }});
  const cat_s = await prisma.category.create({ data: { tenant_id, name_ar: 'قمصان', name_en: 'Shirts' }});
  const cat_j = await prisma.category.create({ data: { tenant_id, name_ar: 'جينز', name_en: 'Jeans' }});

  // Tax (WP-008 Phase C, BR-TAX-200/201): the seeded catalog is a single
  // standard-rate assortment, so one category and one active v1 code at the
  // 14% the pre-Phase-C engine charged. Without an ACTIVE code the seeded
  // variants cannot be priced at all (BR-TAX-201 blocks rather than falling
  // back), which is the intended behaviour, not an oversight.
  const taxCategory = await prisma.taxCategory.create({
    data: {
      tenant_id,
      code: 'STANDARD',
      name_en: 'Standard rate',
      name_ar: 'المعدل القياسي',
    },
  });
  await prisma.taxCode.create({
    data: {
      tenant_id,
      tax_category_id: taxCategory.id,
      code: 'STANDARD',
      name_en: 'Standard rate v1',
      name_ar: 'المعدل القياسي - الإصدار الأول',
      jurisdiction: 'EG',
      rate: 14,
      // BR-TAX-204: the seeded Price Book entries below store tax-exclusive
      // net prices, so the code's own behaviour matches its price context.
      tax_mode: 'exclusive',
      rounding_policy: 'line',
      version: 1,
      status: 'active',
      activated_at: new Date(),
    },
  });

  // Products + Variants – 12 clothing products (28 variants) + 3 simple products
  const productsData = [
    { name_en: 'Classic T-Shirt', brand: 'Bold', category_id: cat_t.id, variants: [
      { sku: 'BOLD-TS-001-S-BLK', size: 'S', color: 'Black', cost: 85, ean: '6223001000011' },
      { sku: 'BOLD-TS-001-M-BLK', size: 'M', color: 'Black', cost: 85, ean: '6223001000012' },
      { sku: 'BOLD-TS-001-L-BLK', size: 'L', color: 'Black', cost: 85, ean: '6223001000013' },
      { sku: 'BOLD-TS-001-M-WHT', size: 'M', color: 'White', cost: 85, ean: '6223001000014' },
    ]},
    { name_en: 'Polo Shirt', brand: 'Bold', category_id: cat_s.id, variants: [
      { sku: 'BOLD-PO-002-M-NAV', size: 'M', color: 'Navy', cost: 140, ean: '6223001000021' },
      { sku: 'BOLD-PO-002-L-NAV', size: 'L', color: 'Navy', cost: 140, ean: '6223001000022' },
      { sku: 'BOLD-PO-002-XL-GRY', size: 'XL', color: 'Gray', cost: 140, ean: '6223001000023' },
    ]},
    { name_en: 'Slim Jeans', brand: 'DenimCo', category_id: cat_j.id, variants: [
      { sku: 'DNM-JN-101-32-BLU', size: '32', color: 'Blue', cost: 210, ean: '6223001001011' },
      { sku: 'DNM-JN-101-34-BLU', size: '34', color: 'Blue', cost: 210, ean: '6223001001012' },
      { sku: 'DNM-JN-101-32-BLK', size: '32', color: 'Black', cost: 210, ean: '6223001001013' },
    ]},
    { name_en: 'Oxford Shirt', brand: 'Bold', category_id: cat_s.id, variants: [
      { sku: 'BOLD-OX-003-M-WHT', size: 'M', color: 'White', cost: 165, ean: '6223001000031' },
      { sku: 'BOLD-OX-003-L-WHT', size: 'L', color: 'White', cost: 165, ean: '6223001000032' },
      { sku: 'BOLD-OX-003-M-BLU', size: 'M', color: 'Blue', cost: 165, ean: '6223001000033' },
    ]},
    { name_en: 'Graphic Tee', brand: 'Bold', category_id: cat_t.id, variants: [
      { sku: 'BOLD-GT-004-M-BLK', size: 'M', color: 'Black', cost: 95, ean: '6223001000041' },
      { sku: 'BOLD-GT-004-L-BLK', size: 'L', color: 'Black', cost: 95, ean: '6223001000042' },
    ]},
    { name_en: 'Chino Pants', brand: 'Classic Wear', category_id: cat_j.id, variants: [
      { sku: 'CL-CH-201-32-BEG', size: '32', color: 'Beige', cost: 190, ean: '6223001002011' },
      { sku: 'CL-CH-201-34-BEG', size: '34', color: 'Beige', cost: 190, ean: '6223001002012' },
      { sku: 'CL-CH-201-32-OLV', size: '32', color: 'Olive', cost: 190, ean: '6223001002013' },
    ]},
    { name_en: 'V-Neck Tee', brand: 'Bold', category_id: cat_t.id, variants: [
      { sku: 'BOLD-VN-005-M-GRY', size: 'M', color: 'Gray', cost: 80, ean: '6223001000051' },
      { sku: 'BOLD-VN-005-L-GRY', size: 'L', color: 'Gray', cost: 80, ean: '6223001000052' },
    ]},
    { name_en: 'Linen Shirt', brand: 'Classic Wear', category_id: cat_s.id, variants: [
      { sku: 'CL-LN-301-M-WHT', size: 'M', color: 'White', cost: 175, ean: '6223001003011' },
      { sku: 'CL-LN-301-L-BEG', size: 'L', color: 'Beige', cost: 175, ean: '6223001003012' },
    ]},
    { name_en: 'Cargo Jeans', brand: 'DenimCo', category_id: cat_j.id, variants: [
      { sku: 'DNM-CG-102-34-GRY', size: '34', color: 'Gray', cost: 230, ean: '6223001001021' },
      { sku: 'DNM-CG-102-36-GRY', size: '36', color: 'Gray', cost: 230, ean: '6223001001022' },
    ]},
    { name_en: 'Henley Tee', brand: 'Bold', category_id: cat_t.id, variants: [
      { sku: 'BOLD-HN-006-M-BLU', size: 'M', color: 'Blue', cost: 90, ean: '6223001000061' },
      { sku: 'BOLD-HN-006-L-BLU', size: 'L', color: 'Blue', cost: 90, ean: '6223001000062' },
    ]},
    { name_en: 'Denim Shirt', brand: 'DenimCo', category_id: cat_s.id, variants: [
      { sku: 'DNM-DS-401-M-IND', size: 'M', color: 'Indigo', cost: 185, ean: '6223001004011' },
      { sku: 'DNM-DS-401-L-IND', size: 'L', color: 'Indigo', cost: 185, ean: '6223001004012' },
    ]},
    { name_en: 'Jogger Pants', brand: 'Bold', category_id: cat_j.id, variants: [
      { sku: 'BOLD-JG-007-M-BLK', size: 'M', color: 'Black', cost: 150, ean: '6223001000071' },
      { sku: 'BOLD-JG-007-L-BLK', size: 'L', color: 'Black', cost: 150, ean: '6223001000072' },
      { sku: 'BOLD-JG-007-M-GRY', size: 'M', color: 'Gray', cost: 150, ean: '6223001000073' },
    ]},
  ];

  // Trade presets are data: the demo tenant is a clothing shop that also sells
  // a few groceries, so it gets both presets (product types, units, scale settings).
  await applyPreset(prisma as any, tenant_id, 'clothing');
  await applyPreset(prisma as any, tenant_id, 'grocery');
  const clothingType = await prisma.productType.findFirstOrThrow({ where: { tenant_id, name_en: 'Clothing' } });
  const uom = async (code: string) => prisma.unitOfMeasure.findFirstOrThrow({ where: { tenant_id, code } });
  const [piece, kilogram] = [await uom('pcs'), await uom('kg')];

  const allVariants: any[] = [];
  for (const p of productsData) {
    const prod = await prisma.product.create({
      data: {
        tenant_id,
        name_en: p.name_en,
        brand: p.brand,
        category_id: p.category_id,
        product_type_id: clothingType.id,
        tax_category_id: taxCategory.id,
        has_variants: true,
        variants: {
          create: p.variants.map(v => ({
            sku: v.sku,
            attributes: { size: v.size, color: v.color },
            label: `${v.size} · ${v.color}`,
            base_uom_id: piece.id,
            cost_price: v.cost,
            return_count: 0,
            barcodes: { create: [{ code: v.ean }, { code: v.sku }] },
          }))
        }
      },
      include: { variants: true }
    });
    allVariants.push(...prod.variants.map(v => ({ ...v, product_name: p.name_en, brand: p.brand, category_id: p.category_id })));
  }

  // Simple (typeless) products of other trades: a pack barcode (6 x water), a
  // plain electronics item, and a weighed item (kg, 3 decimals) sold by scale label.
  const simpleProducts = [
    { name_en: 'Mineral Water 600ml', name_ar: 'مياه معدنية', brand: 'Aqua', sku: 'AQ-W600', cost: 4, uom: piece,
      barcodes: [{ code: '6223002000011' }, { code: '6223002000066', pack_qty: 6 }] },
    { name_en: 'USB-C Charger', name_ar: 'شاحن USB-C', brand: 'Volt', sku: 'VT-CH-20W', cost: 120, uom: piece,
      barcodes: [{ code: '6223003000019' }] },
    { name_en: 'Tomatoes', name_ar: 'طماطم', brand: undefined, sku: 'FR-TOM-KG', cost: 12, uom: kilogram,
      barcodes: [{ code: '2000001', kind: 'scale_plu' as const }] },
  ];
  for (const p of simpleProducts) {
    const prod = await prisma.product.create({
      data: {
        tenant_id,
        name_en: p.name_en,
        name_ar: p.name_ar,
        brand: p.brand,
        tax_category_id: taxCategory.id,
        has_variants: false,
        variants: {
          create: [{
            sku: p.sku,
            base_uom_id: p.uom.id,
            cost_price: p.cost,
            barcodes: { create: p.barcodes },
          }],
        },
      },
      include: { variants: true },
    });
    allVariants.push(...prod.variants.map(v => ({ ...v, product_name: p.name_en, brand: p.brand, category_id: null })));
  }

  // Opening stock: one inventory command per warehouse (opening ledger rows,
  // the warehouse average cost and the variant cost all come from the engine).
  const openingLines = (quantityOf: (index: number) => number) =>
    allVariants
      .map((v, index) => ({ variantId: v.id, qtyDelta: quantityOf(index), unitCost: v.cost_price }))
      .filter((line) => line.qtyDelta > 0);
  const openingQuantities = [
    { warehouse: w1, lines: openingLines((index) => (index === 0 ? 250 : Math.floor(deterministicRandom() * 20) + 2)) },
    { warehouse: w2, lines: openingLines(() => Math.floor(deterministicRandom() * 12)) },
  ];
  await prisma.$transaction(async (tx) => {
    for (const { warehouse, lines } of openingQuantities) {
      await inventory.apply(tx, {
        tenantId: tenant_id,
        warehouseId: warehouse.id,
        occurredAt: new Date(),
        type: 'opening_balance',
        costType: 'opening_balance',
        reference: { type: 'InventorySeed', id: warehouse.id },
        idempotencyKey: `seed-opening:${warehouse.id}`,
        allowNegative: true,
        metadata: { source: 'development-seed' },
        lines,
      });
    }
  });

  // Pricing rules -- WP-008 Phase B: deprecated, PricingService no longer
  // reads this table. Kept only because seeded data is never destructively
  // dropped; the Price Book below is what actually prices these variants now.
  await prisma.pricingRule.create({ data: { tenant_id, name: 'Global Default EG', scope_type: 'global', overhead_percent: 20, profit_percent: 35, tax_percent: 14, formula: 'compound', is_protected: true, priority: 999 }});
  await prisma.pricingRule.create({ data: { tenant_id, name: 'Jeans – 45% Profit', scope_type: 'category', scope_id: cat_j.id, overhead_percent: 20, profit_percent: 45, tax_percent: 14, formula: 'compound', priority: 50 }});
  await prisma.pricingRule.create({ data: { tenant_id, name: 'T-Shirts – 30% Profit', scope_type: 'category', scope_id: cat_t.id, overhead_percent: 20, profit_percent: 30, tax_percent: 14, formula: 'compound', priority: 50 }});

  // Price Book (WP-008 Phase B, BR-PSL-101): the PricingRule rows above no
  // longer price anything -- an unpriced variant blocks sale by default
  // under the new engine, so every seeded variant needs a real
  // PriceBookEntry, not just a PricingRule row. One variant-scoped entry per
  // variant (not a category/global entry), computed with the same
  // overhead/profit rates the PricingRule rows above encode, so seeded demo
  // prices are numerically unchanged from before this phase.
  const priceBook = await prisma.priceBook.create({
    data: {
      tenant_id,
      name: 'Default Price Book',
      currency: tenant.default_currency ?? 'EGP',
      scope: 'tenant_default',
      status: 'active',
      is_default: true,
      activated_at: new Date(),
    },
  });
  const categoryProfitPercent: Record<string, number> = { [cat_j.id]: 45, [cat_t.id]: 30 };
  for (const v of allVariants) {
    const overheadPercent = 20;
    const profitPercent = categoryProfitPercent[v.category_id ?? ''] ?? 35;
    const cost = Number(v.cost_price);
    const unitPrice = Math.round(cost * (1 + overheadPercent / 100) * (1 + profitPercent / 100) * 100) / 100;
    await prisma.priceBookEntry.create({
      data: {
        tenant_id,
        price_book_id: priceBook.id,
        scope_type: 'variant',
        scope_id: v.id,
        min_qty: 1,
        unit_price: unitPrice,
        allow_zero_price: false,
        tax_percent: 14,
        tax_mode: 'exclusive',
        version: 1,
        status: 'active',
      },
    });
  }

  // Customers
  const custData = [
    { name: 'أحمد محمد', phone: '01011111111', total_invoices: 6, total_spent: 2450, is_vip: true },
    { name: 'محمود علي', phone: '01022222222', total_invoices: 3, total_spent: 890, is_vip: false },
    { name: 'كريم سامي', phone: '01033333333', total_invoices: 8, total_spent: 3200, is_vip: true },
    { name: 'عمر خالد', phone: '01044444444', total_invoices: 1, total_spent: 320, is_vip: false },
    { name: 'يوسف حسن', phone: '01055555555', total_invoices: 2, total_spent: 650, is_vip: false },
    { name: 'مصطفى إبراهيم', phone: '01066666666', total_invoices: 4, total_spent: 1400, is_vip: false },
    { name: 'عبدالله', phone: '01077777777', total_invoices: 1, total_spent: 280, is_vip: false },
    { name: 'سيف', phone: '01088888888', total_invoices: 0, total_spent: 0, is_vip: false },
  ];
  const customers = [];
  for (const c of custData) {
    customers.push(await prisma.customer.create({ data: { tenant_id, name: c.name, phone: c.phone, whatsapp: c.phone, is_vip: c.is_vip, total_invoices: c.total_invoices, total_spent: c.total_spent }}));
  }

  // Sales Invoices – 15 with items
  const paymentMethods = ['cash','card','instapay','vodafone_cash','installment'];
  const salesInvoices = [];
  for (let i=0; i<15; i++) {
    const branch = i %3 ===0 ? b2 : b1;
    const customer = customers[i % customers.length];
    const itemCount = Math.floor(deterministicRandom()*3)+1;
    const items = [];
    let subtotal = 0;
    for (let j=0; j<itemCount; j++) {
      const v = allVariants[Math.floor(deterministicRandom()*allVariants.length)];
      const qty = 1;
      const unit_cost = Number(v.cost_price);
      const unit_price = Math.round(unit_cost * 1.2 * 1.35); // net
      subtotal += unit_price * qty;
      items.push({ variant_id: v.id, qty, unit_price, unit_cost });
    }
    const tax_amount = Math.round(subtotal * 0.14);
    const total = subtotal + tax_amount;
    const inv = await prisma.salesInvoice.create({
      data: {
        tenant_id,
        invoice_number: `BOLD-2026${String(1001+i).padStart(4,'0')}`,
        branch_id: branch.id,
        customer_id: deterministicRandom() > 0.3 ? customer.id : null,
        cashier_id: cashier.id,
        seller_id: seller.id,
        seller_name_snapshot: seller.name,
        status: 'completed',
        subtotal, tax_amount, total,
        payment_method: paymentMethods[i % paymentMethods.length],
        language: 'ar',
        created_at: new Date(Date.now() - deterministicRandom()*30*86400000),
        items: { create: items }
      }
    });
    salesInvoices.push(inv);
  }

  // Returns – 2
  for (let i=0; i<2 && i < salesInvoices.length; i++) {
    const s = salesInvoices[i];
    await prisma.return.create({ data: {
    tenant_id,
      original_invoice_id: s.id,
      branch_id: s.branch_id,
      return_invoice_number: `R-${s.invoice_number}`,
      reason: 'مقاس غير مناسب',
      is_partial: true,
      created_by: cashier.id
    }});
  }

  // Purchase Invoices – 3 with line items
  const pi1 = await prisma.purchaseInvoice.create({ data: {
    tenant_id,
    supplier_id: s1.id, branch_id: b1.id, invoice_number: 'SUP-2026-001',
    subtotal: 4200, discount_amount: 200, discount_percent: 0, total: 4000,
    created_by: warehouse.id,
    items: { create: [
      { variant_id: allVariants[0].id, qty: 50, unit_cost: 80 },
      { variant_id: allVariants[1].id, qty: 30, unit_cost: 80 },
      { variant_id: allVariants[4].id, qty: 20, unit_cost: 130 },
    ]}
  }});
  await prisma.purchaseInvoice.create({ data: {
    tenant_id,
    supplier_id: s2.id, branch_id: b1.id, invoice_number: 'SUP-2026-002',
    subtotal: 3100, discount_amount: 155, discount_percent: 5, total: 2945,
    created_by: warehouse.id,
    items: { create: [
      { variant_id: allVariants[5].id, qty: 15, unit_cost: 160 },
      { variant_id: allVariants[6].id, qty: 10, unit_cost: 90 },
    ]}
  }});
  await prisma.purchaseInvoice.create({ data: {
    tenant_id,
    supplier_id: s3.id, branch_id: b2.id, invoice_number: 'SUP-2026-003',
    subtotal: 5600, discount_amount: 300, discount_percent: 0, total: 5300,
    created_by: warehouse.id,
    items: { create: [
      { variant_id: allVariants[10].id, qty: 25, unit_cost: 175 },
      { variant_id: allVariants[15].id, qty: 20, unit_cost: 140 },
    ]}
  }});

  // Transfers – 2 with items
  const tr1 = await prisma.transfer.create({ data: {
    tenant_id,
    from_branch_id: b1.id, to_branch_id: b2.id,
    transfer_number: 'TR-2026001', status: 'received', created_by: manager.id,
    items: { create: [
      { variant_id: allVariants[0].id, qty: 5 },
      { variant_id: allVariants[2].id, qty: 3 },
    ]}
  }});
  await prisma.transfer.create({ data: {
    tenant_id,
    from_branch_id: b2.id, to_branch_id: b1.id,
    transfer_number: 'TR-2026002', status: 'pending', created_by: manager.id,
    items: { create: [
      { variant_id: allVariants[5].id, qty: 2 },
    ]}
  }});

  // Offer suggestions – 3
  for (const v of allVariants.slice(0,3)) {
    const cost = Number(v.cost_price);
    const current = Math.round(cost * 1.2 * 1.35 * 1.14);
    const min_allowed = Math.round(cost * 1.2 * 1.14);
    await prisma.offerSuggestion.create({ data: {
      tenant_id,
      variant_id: v.id, branch_id: b1.id, days_unsold: 95,
      current_price: current,
      suggested_price: Math.round((current + min_allowed)/2),
      min_allowed_price: min_allowed,
      status: 'pending'
    }});
  }

  console.log(`
✅ Bold POS Test Data v2.1 – Full

Branches: 2
Users: 5 – all password Bold1234
  owner:            +200100000000
  branch_manager:   +200100000001
  cashier:          +200100000002
  warehouse:        +200100000003
  seller:           +200100000004
Suppliers: 3
Categories: 3
Products: 12 – Variants: ${allVariants.length}
Customers: 8 – VIP: 01011111111, 01033333333
Sales Invoices: 15 – with items
Returns: 2
Purchase Invoices: 3 – WITH line items
Transfers: 2 – WITH line items
Pricing Rules: 3
Offers: 3

Test barcode: 6223001000011
Test customer: 01011111111
API: http://localhost:3000/api/docs
`);
}

main().catch(e=>{ console.error(e); process.exit(1)}).finally(()=>prisma.$disconnect());
