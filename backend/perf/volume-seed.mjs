import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
// Stock is written through the application's single writer (needs `npm run build`).
import { InventoryService } from '../dist/src/inventory/inventory.service.js'
import { InventoryRepository } from '../dist/src/inventory/inventory.repository.js'

const databaseUrl = process.env.DATABASE_URL || ''
if (!databaseUrl.includes('athr_perf') && process.env.PERF_ALLOW_VOLUME_SEED !== '1') {
  throw new Error('Volume seeding is restricted to a database whose URL contains athr_perf. Set PERF_ALLOW_VOLUME_SEED=1 only for an isolated performance database.')
}

const prisma = new PrismaClient()
const inventory = new InventoryService(new InventoryRepository(prisma))
function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function stableUuid(kind, index) {
  const hex = createHash('sha256').update(`bold-perf:${kind}:${index}`).digest('hex').slice(0, 32).split('')
  hex[12] = '4'
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`
}

const productCount = positiveInteger('PERF_PRODUCTS', 10_000)
const invoiceCount = positiveInteger('PERF_INVOICES', 50_000)
const batchSize = 500

try {
const branch = await prisma.branch.findFirst({ where: { is_active: true } })
const category = await prisma.category.findFirst()
// WP-008 Phase C (BR-TAX-201): Product.tax_category_id is NOT NULL. The
// development seed creates one STANDARD category per tenant; reuse it rather
// than inventing a second one, so perf rows tax exactly like seeded rows.
const taxCategory = await prisma.taxCategory.findFirst({
  where: { tenant_id: branch?.tenant_id, code: 'STANDARD' },
})
if (!branch || !category || !taxCategory) throw new Error('Run the normal development seed before volume-seed.mjs')
// The branch's default warehouse holds the stock (the development seed creates one per branch).
const warehouse = await prisma.warehouse.findFirst({ where: { tenant_id: branch.tenant_id, branch_id: branch.id, is_default: true } })
if (!warehouse) throw new Error(`Branch ${branch.id} has no default Warehouse -- run the normal development seed before volume-seed.mjs`)

const variantIds = []
for (let offset = 0; offset < productCount; offset += batchSize) {
  const size = Math.min(batchSize, productCount - offset)
  const indexes = Array.from({ length: size }, (_, local) => offset + local)
  const skus = indexes.map((index) => `PERF-${String(index).padStart(8, '0')}`)
  const existing = await prisma.productVariant.findMany({ where:{sku:{in:skus}}, select:{id:true,sku:true} })
  const existingBySku = new Map(existing.map((variant) => [variant.sku, variant.id]))
  const missingIndexes = indexes.filter((index) => !existingBySku.has(`PERF-${String(index).padStart(8, '0')}`))
  const products = missingIndexes.map((index) => ({
    id: stableUuid('product', index), tenant_id: branch.tenant_id, name_en: `Performance product ${index}`,
    name_ar: `منتج اختبار أداء ${index}`, category_id: category.id,
    tax_category_id: taxCategory.id,
    brand: 'Bold Perf', has_variants: false,
  }))
  const variants = products.map((product) => {
    const index = Number(product.name_en.slice('Performance product '.length))
    const id = stableUuid('variant', index)
    return { id, tenant_id: branch.tenant_id, product_id: product.id, sku: `PERF-${String(index).padStart(8, '0')}`, cost_price: 100 + (index % 200) }
  })
  const newVariantBySku = new Map(variants.map((variant) => [variant.sku, variant.id]))
  const batchVariantIds = skus.map((sku) => existingBySku.get(sku) || newVariantBySku.get(sku))
  if (batchVariantIds.some((id) => !id)) throw new Error(`Unable to resolve every performance variant in batch ${offset}`)
  variantIds.push(...batchVariantIds)
  await prisma.$transaction([
    prisma.product.createMany({ data: products, skipDuplicates: true }),
    prisma.productVariant.createMany({ data: variants, skipDuplicates: true }),
  ])
  // One opening command per batch: stock, its ledger rows and the warehouse cost together.
  await prisma.$transaction((tx) => inventory.apply(tx, {
    tenantId: branch.tenant_id,
    warehouseId: warehouse.id,
    occurredAt: new Date(),
    type: 'opening_balance',
    costType: 'opening_balance',
    reference: { type: 'InventorySeed', id: warehouse.id },
    idempotencyKey: `volume-seed:${warehouse.id}:${offset}`,
    allowNegative: true,
    metadata: { source: 'volume-seed' },
    lines: batchVariantIds.map((variantId, local) => ({ variantId, qtyDelta: 100_000, unitCost: 100 + ((offset + local) % 200) })),
  }), { timeout: 120_000 })
  process.stdout.write(`\rproducts ${Math.min(offset + size, productCount)}/${productCount}`)
}
process.stdout.write('\n')

// WP-P1 H1: none of the bulk PERF-* variants above have a resolvable selling
// price -- PricingService.quoteMany() only resolves entries in the tenant's
// *default* PriceBook, and this script never touched pricing, so /sync/pull's
// snapshot (which filters to `quotes.has(variant.id)`) silently excludes all
// 10,000 of them. Every sale-mutation-load candidate before this was drawn
// from the small pre-existing dev-seed catalog only, regardless of
// PERF_PRODUCTS. One 'global'-scope entry in the default book is the lowest
// priority in BR-PSL-100's variant->product->brand->category->global order,
// so it prices every PERF-* variant as a fallback without changing what any
// more-specifically-priced dev-seed product resolves to.
const defaultPriceBook = await prisma.priceBook.findFirst({
  where: { tenant_id: branch.tenant_id, status: 'active', is_default: true },
})
if (defaultPriceBook) {
  const existingGlobalEntry = await prisma.priceBookEntry.findFirst({
    where: {
      tenant_id: branch.tenant_id,
      price_book_id: defaultPriceBook.id,
      scope_type: 'global',
      status: 'active',
    },
  })
  if (!existingGlobalEntry) {
    await prisma.priceBookEntry.create({
      data: {
        tenant_id: branch.tenant_id,
        price_book_id: defaultPriceBook.id,
        scope_type: 'global',
        scope_id: null,
        min_qty: 1,
        unit_price: 150,
        allow_zero_price: false,
        tax_mode: 'exclusive',
        effective_from: new Date(0),
        effective_to: null,
        status: 'active',
      },
    })
  }
} else {
  process.stdout.write(
    'volume-seed: no active default PriceBook found for the tenant; PERF-* variants remain unpriced.\n',
  )
}

for (let offset = 0; offset < invoiceCount; offset += batchSize) {
  const size = Math.min(batchSize, invoiceCount - offset)
  const indexes = Array.from({ length: size }, (_, local) => offset + local)
  const numbers = indexes.map((index) => `PERF-INV-${String(index).padStart(10, '0')}`)
  const existing = await prisma.salesInvoice.findMany({ where:{invoice_number:{in:numbers}}, select:{id:true,invoice_number:true} })
  const existingNumbers = new Set(existing.map((invoice) => invoice.invoice_number))
  const missingIndexes = indexes.filter((index) => !existingNumbers.has(`PERF-INV-${String(index).padStart(10, '0')}`))
  const invoices = missingIndexes.map((index) => {
    return {
      id: stableUuid('invoice', index), tenant_id: branch.tenant_id, invoice_number: `PERF-INV-${String(index).padStart(10, '0')}`,
      branch_id: branch.id, subtotal: 100, tax_amount: 14, total: 114,
      status: 'completed', language: 'ar',
      created_at: new Date(Date.now() - (index % 365) * 86_400_000),
    }
  })
  const items = invoices.map((invoice) => {
    const index = Number(invoice.invoice_number.slice('PERF-INV-'.length))
    return {
      id: stableUuid('invoice-item', index),
      tenant_id: branch.tenant_id,
      sales_invoice_id: invoice.id,
      variant_id: variantIds[index % variantIds.length],
      qty: 1,
      unit_price: 100,
      unit_cost: 70,
      unit_tax: 14,
    }
  })
  await prisma.$transaction([
    prisma.salesInvoice.createMany({ data: invoices, skipDuplicates: true }),
    prisma.salesInvoiceItem.createMany({ data: items, skipDuplicates: true }),
    prisma.salesPayment.createMany({
      data: invoices.map((invoice, position) => ({
        id: stableUuid('invoice-payment', Number(invoice.invoice_number.slice('PERF-INV-'.length))),
        tenant_id: invoice.tenant_id, sales_invoice_id: invoice.id, sequence: 1,
        method: position % 2 ? 'cash' : 'card', amount: invoice.total,
      })),
      skipDuplicates: true,
    }),
  ])
  process.stdout.write(`\rinvoices ${Math.min(offset + size, invoiceCount)}/${invoiceCount}`)
}
process.stdout.write('\nvolume seed complete\n')
} finally {
  await prisma.$disconnect()
}
