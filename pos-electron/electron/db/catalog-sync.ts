import {
  CATALOG_FORMAT_VERSION,
  CATALOG_PRODUCT_VERSION,
  isValidCatalogStock,
  isValidWireProduct,
} from '../catalog-format'
import { decimalToMinorUnits } from '../money-codec'
import { catalogNeedsFullRefresh, requireFullCatalogRefresh, snapshotProgress } from './catalog'
import { db } from './connection'
import { run, setMeta, tx } from './queries'
import { isValidScaleBarcodeConfig, TENANT_SETTINGS_KEY } from './tenant-settings'

function validatePull(data: any) {
  const products = Array.isArray(data?.products) ? data.products : []
  const stock = Array.isArray(data?.stock) ? data.stock : []
  const sellers = Array.isArray(data?.sellers) ? data.sellers : []
  const isSnapshot = data?.mode === 'snapshot'
  const startsSnapshot = isSnapshot && data.reset_products === true

  if (Number(data?.catalog_version) !== CATALOG_PRODUCT_VERSION) {
    throw new Error(`The server did not return a v${CATALOG_PRODUCT_VERSION} catalog`)
  }
  if (!isSnapshot && data?.mode !== 'delta') {
    throw new Error('The server returned an unknown catalog mode')
  }
  // A delta may only extend a complete catalog; a snapshot page after the
  // first must continue the snapshot this database started.
  if (!isSnapshot && (catalogNeedsFullRefresh() || snapshotProgress())) {
    throw new Error('A complete catalog snapshot is required before delta synchronization')
  }
  if (isSnapshot && !startsSnapshot && snapshotProgress()?.cursor !== String(data.cursor)) {
    throw new Error('This catalog snapshot page does not continue the snapshot in progress')
  }
  if (isSnapshot && data.has_more && !String(data.snapshot_after || '')) {
    throw new Error('The server did not say where the catalog snapshot continues')
  }
  // Validate before changing the usable catalog: a malformed server response
  // must leave the old catalog and cursor intact.
  if (products.some((product: any) => !isValidWireProduct(product))) {
    throw new Error(`The server returned an invalid v${CATALOG_PRODUCT_VERSION} catalog product`)
  }
  if (stock.some((entry: any) => !isValidCatalogStock(entry))) {
    throw new Error('The server returned invalid branch stock data')
  }
  if (
    sellers.some(
      (seller: any) =>
        !/^[0-9a-f-]{36}$/i.test(String(seller?.id || '')) ||
        !String(seller?.name || '').trim(),
    )
  ) {
    throw new Error('The server returned invalid branch seller data')
  }
  if (data.settings !== undefined && !isValidScaleBarcodeConfig(data.settings?.scale_barcode)) {
    throw new Error('The server returned invalid tenant settings')
  }
  return { products, stock, sellers, isSnapshot, startsSnapshot }
}

function upsertProduct(p: any) {
  const sellingPrice = Number(p.selling_price || 0)
  const unitTax = Number(p.unit_tax || 0)
  run(
    `INSERT OR REPLACE INTO products (
      id,sku,name_en,name_ar,label,attributes,uom_code,uom_name_ar,uom_precision,
      cost_price,selling_price,unit_tax,catalog_version,
      cost_price_minor_units,selling_price_minor_units,unit_tax_minor_units
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      p.id, p.sku, p.name_en || '', p.name_ar || '',
      p.label || null,
      p.attributes ? JSON.stringify(p.attributes) : null,
      p.uom_code || null, p.uom_name_ar || null, Number(p.uom_precision || 0),
      0, sellingPrice, unitTax, Number(p.catalog_version),
      0, decimalToMinorUnits(sellingPrice), decimalToMinorUnits(unitTax),
    ],
  )
  // A barcode belongs to one variant: replace by code, drop the ones removed upstream.
  run(`DELETE FROM barcodes WHERE variant_id=?`, [p.id])
  for (const barcode of p.barcodes) {
    run(`INSERT OR REPLACE INTO barcodes (code,variant_id,pack_qty,kind) VALUES (?,?,?,?)`, [
      barcode.code, p.id, Number(barcode.pack_qty), barcode.kind,
    ])
  }
}

/**
 * Applies one catalog page (snapshot page or delta) in one transaction.
 *
 * A snapshot is written page by page, so the catalog is only trusted again
 * after its LAST page: the first page invalidates the old cursor and format
 * version, the middle pages record where to resume, and only the last page
 * stores the cursor and format version. A crash in between can therefore
 * never leave a partial catalog behind a valid cursor.
 */
export function applyCatalogPull(data: any) {
  const { products, stock, sellers, isSnapshot, startsSnapshot } = validatePull(data)
  tx(() => {
    if (startsSnapshot) {
      requireFullCatalogRefresh()
      db().exec('DELETE FROM products; DELETE FROM barcodes')
    }
    if (data.reset_stock) db().exec('DELETE FROM stock')
    if (data.reset_sellers) db().exec('DELETE FROM sellers')
    for (const id of data.deleted_variant_ids || []) {
      run(`DELETE FROM products WHERE id=?`, [id])
      run(`DELETE FROM barcodes WHERE variant_id=?`, [id])
      run(`DELETE FROM stock WHERE variant_id=?`, [id])
    }
    for (const product of products) upsertProduct(product)
    for (const s of stock) {
      run(`INSERT OR REPLACE INTO stock (variant_id,qty) VALUES (?,?)`, [
        s.variant_id,
        Number(s.qty_on_hand),
      ])
    }
    for (const seller of sellers) {
      run(`INSERT OR REPLACE INTO sellers (id,name) VALUES (?,?)`, [
        seller.id,
        String(seller.name).trim(),
      ])
    }
    if (data.settings !== undefined) setMeta(TENANT_SETTINGS_KEY, JSON.stringify(data.settings))

    if (isSnapshot && data.has_more) {
      setMeta('snapshot_after', String(data.snapshot_after))
      setMeta('snapshot_cursor', String(data.cursor))
      return
    }
    if (isSnapshot) {
      setMeta('snapshot_after', '')
      setMeta('snapshot_cursor', '')
      setMeta('catalog_format_version', CATALOG_FORMAT_VERSION)
    }
    if (data.cursor !== undefined) setMeta('sync_cursor', String(data.cursor))
    if (data.catalog_valid_until !== undefined) {
      setMeta('catalog_valid_until', String(data.catalog_valid_until || ''))
    }
  })
}
