import { exceedsDiscountLimit, hasAnyDiscount, lineWithoutTaxRate, priceCart, type Discount } from '../electron/sale-math'
import type { CartItem } from './types'

export type DiscountTarget = { kind: 'invoice' } | { kind: 'line'; variantId: string }

export interface DiscountPreview {
  /** Arabic reason the discount cannot be given (null when it can). */
  error: string | null
  /** Net discount of the whole invoice after this change. */
  discount: number
  /** What the customer would pay. */
  total: number
}

/** The cart with `candidate` applied to `target` (null removes it). */
export function withDiscount(
  items: CartItem[],
  invoiceDiscount: Discount | null,
  target: DiscountTarget,
  candidate: Discount | null,
): { items: CartItem[]; invoiceDiscount: Discount | null } {
  if (target.kind === 'invoice') return { items, invoiceDiscount: candidate }
  return {
    items: items.map((item) => (item.variant_id === target.variantId ? { ...item, discount: candidate } : item)),
    invoiceDiscount,
  }
}

/**
 * What a discount would do, and whether this cashier may give it. The limit is
 * the same one the till re-checks when the sale is saved (`priceAndCheckSale`),
 * so the screen never offers what the till would then refuse.
 */
export function previewDiscount(
  items: CartItem[],
  invoiceDiscount: Discount | null,
  target: DiscountTarget,
  candidate: Discount | null,
  limitPercent: number,
): DiscountPreview {
  const next = withDiscount(items, invoiceDiscount, target, candidate)
  const priced = priceCart(next.items, next.invoiceDiscount)
  const base = { discount: priced.discount, total: priced.total }
  if (hasAnyDiscount(next.items, next.invoiceDiscount) && lineWithoutTaxRate(next.items)) {
    return { ...base, error: 'نفّذ مزامنة الكتالوج أولًا: بيانات ضريبة بعض الأصناف غير مكتملة لحساب الخصم.' }
  }
  if (exceedsDiscountLimit(priced, limitPercent)) {
    return { ...base, error: `الخصم أعلى من الحد المسموح (${limitPercent}%). اطلب مديرًا لمنح هذا الخصم.` }
  }
  return { ...base, error: null }
}
