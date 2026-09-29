import {
  CATALOG_FORMAT_VERSION,
  isValidCatalogProduct,
  isValidCatalogStock,
} from '../catalog-format'
import { decimalToMinorUnits } from '../money-codec'
import { catalogNeedsFullRefresh } from './catalog'
import { db } from './connection'
import { run, setMeta, tx } from './queries'

function validatePull(data: any) {
  const products = Array.isArray(data?.products) ? data.products : []
  const stock = Array.isArray(data?.stock) ? data.stock : []
  const sellers = Array.isArray(data?.sellers) ? data.sellers : []

  // Never advance an old cursor while the local database still requires the
  // v2 catalog contract. A complete reset response is mandatory.
  if (catalogNeedsFullRefresh() && !data?.reset_products) {
    throw new Error(
      'A complete v2 catalog snapshot is required before delta synchronization',
    )
  }
  // Validate before changing the usable catalog: a malformed server response
  // must leave the old catalog and cursor intact.
  if (products.some((product: any) => !isValidCatalogProduct(product))) {
    throw new Error('The server returned an invalid v2 catalog product')
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
  return { products, stock, sellers }
}

/** Applies a catalog snapshot or delta in one transaction. */
export function applyCatalogPull(data: any) {
  const { products, stock, sellers } = validatePull(data)
  tx(() => {
    if (data.reset_products) db().exec('DELETE FROM products')
    if (data.reset_stock) db().exec('DELETE FROM stock')
    if (data.reset_sellers) db().exec('DELETE FROM sellers')
    for (const id of data.deleted_variant_ids || []) {
      run(`DELETE FROM products WHERE id=?`, [id])
      run(`DELETE FROM stock WHERE variant_id=?`, [id])
    }
    for (const p of products) {
      const sellingPrice = Number(p.selling_price || 0)
      const unitTax = Number(p.unit_tax || 0)
      run(
        `INSERT OR REPLACE INTO products (
          id,sku,name_en,name_ar,barcode_ean13,barcode_internal,size,color,
          cost_price,selling_price,unit_tax,catalog_version,
          cost_price_minor_units,selling_price_minor_units,unit_tax_minor_units
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          p.id, p.sku, p.name_en || '', p.name_ar || '',
          p.barcode_ean13 || null, p.barcode_internal || null,
          p.size || null, p.color || null, 0,
          sellingPrice, unitTax,
          Number(p.catalog_version || 0),
          0,
          decimalToMinorUnits(sellingPrice),
          decimalToMinorUnits(unitTax),
        ],
      )
    }
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
    if (data.reset_products) setMeta('catalog_format_version', CATALOG_FORMAT_VERSION)
    if (data.cursor !== undefined) setMeta('sync_cursor', String(data.cursor))
    if (data.catalog_valid_until !== undefined) {
      setMeta('catalog_valid_until', String(data.catalog_valid_until || ''))
    }
  })
}
