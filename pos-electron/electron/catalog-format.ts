import { isValidQuantity, quantityToMilli } from './quantity'

// The catalog format identifies the locally cached data contract. Prices are
// historical sale inputs, not credentials that can expire after checkout.
export const CATALOG_FORMAT_VERSION = 'offline-sales-v3'

/** The wire `catalog_version` this POS understands. */
export const CATALOG_PRODUCT_VERSION = 3

export type CatalogProduct = {
  id?: unknown
  sku?: unknown
  name_en?: unknown
  name_ar?: unknown
  selling_price?: unknown
  unit_tax?: unknown
  catalog_version?: unknown
}

export type WireCatalogProduct = CatalogProduct & {
  label?: unknown
  uom_precision?: unknown
  barcodes?: unknown
}

export type CatalogStock = {
  variant_id?: unknown
  qty_on_hand?: unknown
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
}

/** A cached product row (or the common part of a wire product). */
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
    Number(product.catalog_version) === CATALOG_PRODUCT_VERSION
  )
}

function isValidBarcode(barcode: any) {
  return (
    nonEmptyString(barcode?.code) &&
    (barcode.kind === 'standard' || barcode.kind === 'scale_plu') &&
    isValidQuantity(Number(barcode.pack_qty))
  )
}

/** A product as the server sends it: the row rules plus unit precision and barcodes. */
export function isValidWireProduct(product: WireCatalogProduct) {
  const precision = Number(product.uom_precision ?? 0)
  return (
    isValidCatalogProduct(product) &&
    Number.isInteger(precision) &&
    precision >= 0 &&
    precision <= 3 &&
    (product.label === undefined || product.label === null || typeof product.label === 'string') &&
    Array.isArray(product.barcodes) &&
    product.barcodes.every(isValidBarcode)
  )
}

/** Stock is a non-negative decimal with at most three places (Decimal(14,3) upstream). */
export function isValidCatalogStock(stock: CatalogStock) {
  const quantity = Number(stock.qty_on_hand)
  if (!nonEmptyString(stock.variant_id) || !Number.isFinite(quantity) || quantity < 0) return false
  try {
    return quantityToMilli(quantity) >= 0
  } catch {
    return false
  }
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
