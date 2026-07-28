// The catalog format identifies the locally cached data contract. Prices are
// historical sale inputs, not credentials that can expire after checkout.
export const CATALOG_FORMAT_VERSION = 'offline-sales-v2'

export type CatalogProduct = {
  id?: unknown
  sku?: unknown
  name_en?: unknown
  name_ar?: unknown
  selling_price?: unknown
  unit_tax?: unknown
  catalog_version?: unknown
}

export type CatalogStock = {
  variant_id?: unknown
  qty_on_hand?: unknown
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

export function isValidCatalogProduct(product: CatalogProduct) {
  const price = Number(product.selling_price)
  const tax = Number(product.unit_tax)

  return (
    nonEmptyString(product.id) &&
    nonEmptyString(product.sku) &&
    (nonEmptyString(product.name_ar) || nonEmptyString(product.name_en)) &&
    Number.isFinite(price) &&
    price >= 0 &&
    Number.isFinite(tax) &&
    tax >= 0 &&
    Number(product.catalog_version) === 2
  )
}

export function isValidCatalogStock(stock: CatalogStock) {
  const quantity = Number(stock.qty_on_hand)
  return (
    nonEmptyString(stock.variant_id) &&
    Number.isInteger(quantity) &&
    quantity >= 0
  )
}

export function requiresFullCatalogRefresh(
  storedFormatVersion: string,
  invalidProductCount: number,
) {
  return (
    storedFormatVersion !== CATALOG_FORMAT_VERSION ||
    Math.max(0, Number(invalidProductCount) || 0) > 0
  )
}
