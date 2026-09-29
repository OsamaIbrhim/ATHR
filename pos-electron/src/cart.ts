import { addQuantity, isValidQuantity } from '../electron/quantity'
import { CartItem, Product } from './types'

export type AddResult =
  | { status: 'added'; cart: CartItem[] }
  | { status: 'no_more'; cart: CartItem[] }
  | { status: 'unavailable'; cart: CartItem[] }
  | { status: 'invalid_qty'; cart: CartItem[] }

const precisionOf = (product: { uom_precision?: number }) => Number(product.uom_precision) || 0

/**
 * Merge a scanned product into the latest cart; never creates a duplicate
 * line. `addQty` is what one scan adds: 1, a barcode's pack size, or a scale
 * label's weight.
 */
export function addProductToCart(
  cart: CartItem[],
  product: Product,
  available: number,
  price: number,
  tax: number,
  name: string,
  addQty = 1,
): AddResult {
  if (!isValidQuantity(addQty, precisionOf(product))) return { status: 'invalid_qty', cart }
  const existing = cart.find((item) => item.variant_id === product.id)
  if (!existing && available <= 0) return { status: 'unavailable', cart }
  const next = existing ? addQuantity(existing.qty, addQty) : addQty
  if (next > available) return { status: 'no_more', cart }
  if (existing) {
    return {
      status: 'added',
      cart: cart.map((item) => (item.variant_id === product.id ? { ...item, qty: next } : item)),
    }
  }
  return {
    status: 'added',
    cart: [
      ...cart,
      { ...product, variant_id: product.id, name, qty: next, unit_price: price, unit_tax: tax, available_qty: available },
    ],
  }
}

/**
 * Set a line quantity. <=0 removes it; above available keeps it and reports
 * the limit; finer than the unit allows keeps it and reports the line.
 */
export function setLineQty(cart: CartItem[], variantId: string, next: number) {
  let limited: CartItem | null = null
  let invalid: CartItem | null = null
  const result = cart.flatMap((item) => {
    if (item.variant_id !== variantId) return [item]
    if (!(next > 0)) return []
    if (!isValidQuantity(next, precisionOf(item))) {
      invalid = item
      return [item]
    }
    if (next > item.available_qty) {
      limited = item
      return [item]
    }
    return [{ ...item, qty: next }]
  })
  return { cart: result, limited: limited as CartItem | null, invalid: invalid as CartItem | null }
}
