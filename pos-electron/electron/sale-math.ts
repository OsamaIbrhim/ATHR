import { isDiscountAboveLimit, priceSale, type DiscountSpec, type PricedSale, type SaleLineInput, type TaxMode } from '@athr/domain-core'

/**
 * The till's sale arithmetic. It is the backend's own (`@athr/domain-core`
 * `priceSale`), so a sale priced here and the same sale received by the server
 * cannot differ by a piastre. Pure: used by the register screen, the main
 * process (re-checking the total before it commits) and the exchange.
 */

export type Discount = { type: 'amount' | 'percent'; value: number }

export interface PricedCartLine {
  variant_id: string
  qty: number
  unit_price: number
  unit_tax: number
  /** Percent, as the catalog sends it. Null for a row cached before W3 (no discount can be given on it). */
  tax_rate?: string | number | null
  tax_mode?: TaxMode | string | null
  discount?: Discount | null
}

export interface PricedCartLineResult {
  variant_id: string
  /** Tax-exclusive amount after discounts. */
  net: number
  tax: number
  /** What the customer pays for the line. */
  gross: number
  /** The tax-exclusive discount (own + share of the invoice discount). */
  discount: number
}

export interface PricedCart {
  /** Net before discounts. */
  subtotal: number
  /** Net discount. */
  discount: number
  tax: number
  /** What the customer pays. */
  total: number
  lines: PricedCartLineResult[]
  sale: PricedSale
}

const spec = (discount: Discount | null | undefined): DiscountSpec | null =>
  discount && Number(discount.value) > 0 ? { type: discount.type, value: discount.value } : null

/** True when any line or the invoice carries a discount: then every line's tax is recomputed and needs its rate. */
export function hasAnyDiscount(lines: readonly PricedCartLine[], invoiceDiscount?: Discount | null): boolean {
  return !!spec(invoiceDiscount) || lines.some((line) => !!spec(line.discount))
}

/** The first line that cannot be discounted because the catalog row has no tax rate yet (null when all can). */
export function lineWithoutTaxRate(lines: readonly PricedCartLine[]): PricedCartLine | null {
  return (
    lines.find(
      (line) =>
        line.tax_rate === null ||
        line.tax_rate === undefined ||
        (line.tax_mode !== 'inclusive' && line.tax_mode !== 'exclusive'),
    ) ?? null
  )
}

export function priceCart(lines: readonly PricedCartLine[], invoiceDiscount?: Discount | null): PricedCart {
  const inputs: SaleLineInput[] = lines.map((line) => ({
    qty: line.qty,
    unitPrice: line.unit_price,
    unitTax: line.unit_tax,
    taxRate: line.tax_rate ?? 0,
    taxMode: line.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    discount: spec(line.discount),
  }))
  const sale = priceSale(inputs, spec(invoiceDiscount))
  return {
    subtotal: Number(sale.totals.subtotal),
    discount: Number(sale.totals.discountTotal),
    tax: Number(sale.totals.taxTotal),
    total: Number(sale.totals.total),
    lines: sale.lines.map((line, index) => ({
      variant_id: lines[index]!.variant_id,
      net: Number(line.net),
      tax: Number(line.tax),
      gross: Number(line.gross),
      discount: Number(line.discountNet),
    })),
    sale,
  }
}

/** True when some line's discount (its own plus its invoice share) is above `maxPercent` of what the cashier saw for it. */
export function exceedsDiscountLimit(cart: PricedCart, maxPercent: number): boolean {
  return isDiscountAboveLimit(cart.sale.lines, maxPercent)
}

/**
 * The discount a cashier may give without a manager: the tenant limit for a
 * cashier, no limit for a branch manager (`sales.discount.override`). The
 * server enforces the same by the cashier's permissions and flags the sale
 * `DISCOUNT_ABOVE_LIMIT` when a till lets one through.
 */
export function discountLimitFor(role: string, maxDiscountPercent: number): number {
  return role === 'branch_manager' ? 100 : maxDiscountPercent
}

/** A discount typed by the cashier, or null when it is empty or unusable. Percent is capped at 100. */
export function cleanDiscount(type: string, rawValue: string | number): Discount | null {
  const value = Number(String(rawValue).trim().replace(',', '.'))
  if ((type !== 'amount' && type !== 'percent') || !Number.isFinite(value) || value <= 0) return null
  if (type === 'percent' && value > 100) return null
  return { type, value: Math.round(value * 100) / 100 }
}
