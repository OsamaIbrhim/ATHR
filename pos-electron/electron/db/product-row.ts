import { minorUnitsToDecimal } from '../money-codec'

/**
 * A cached `products` row as the renderer sees it: the stored integer minor
 * units become the decimal `selling_price` / `unit_tax` of the catalog wire
 * format. The minor-unit columns never leave the main process.
 */
export function toCatalogProduct(row: Record<string, any>): Record<string, any> {
  const { selling_price_minor_units, unit_tax_minor_units, ...rest } = row
  return {
    ...rest,
    selling_price: Number(minorUnitsToDecimal(Number(selling_price_minor_units ?? 0))),
    unit_tax: Number(minorUnitsToDecimal(Number(unit_tax_minor_units ?? 0))),
  }
}
