import { priceCart, type Discount } from '../electron/sale-math'
import { CartItem } from './types'
import { formatMoney, fromCents, lineCents, toCents } from '../electron/money'
import { sumQuantities } from '../electron/quantity'

export { fromCents, lineCents, toCents }

export const money = (value: number | string | null | undefined) =>
  formatMoney(value ?? 0)

/** What the customer pays for the cart: the shared sale arithmetic, with line and invoice discounts. */
export function cartTotals(items: CartItem[], invoiceDiscount?: Discount | null) {
  const priced = priceCart(items, invoiceDiscount)
  return {
    subtotal: priced.subtotal,
    discount: priced.discount,
    tax: priced.tax,
    total: priced.total,
    quantity: sumQuantities(items.map((item) => item.qty)),
    lines: items.length,
  }
}

export function normalizeEgyptianPhone(value: string) {
  return value.trim().replace(/[\s-]+/g, '')
}

export function isValidEgyptianPhone(value: string) {
  return /^(?:\+20|0)1[0125]\d{8}$/.test(normalizeEgyptianPhone(value))
}

export { paymentLabel } from '../electron/payment-methods'
