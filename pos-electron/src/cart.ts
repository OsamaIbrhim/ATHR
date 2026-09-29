import { CartItem, Product } from './types'

export type AddResult =
  | { status: 'added'; cart: CartItem[] }
  | { status: 'no_more'; cart: CartItem[] }
  | { status: 'unavailable'; cart: CartItem[] }

/** Merge a scanned product into the latest cart; never creates a duplicate line. */
export function addProductToCart(
  cart: CartItem[],
  product: Product,
  available: number,
  price: number,
  tax: number,
  name: string,
): AddResult {
  const existing = cart.find((item) => item.variant_id === product.id)
  if (existing && existing.qty >= available) return { status: 'no_more', cart }
  if (!existing && available <= 0) return { status: 'unavailable', cart }
  if (existing) {
    return {
      status: 'added',
      cart: cart.map((item) =>
        item.variant_id === product.id ? { ...item, qty: item.qty + 1 } : item,
      ),
    }
  }
  return {
    status: 'added',
    cart: [
      ...cart,
      { ...product, variant_id: product.id, name, qty: 1, unit_price: price, unit_tax: tax, available_qty: available },
    ],
  }
}

/** Set a line quantity; <=0 removes it, above available keeps it and reports the limit. */
export function setLineQty(cart: CartItem[], variantId: string, next: number) {
  let limited: CartItem | null = null
  const result = cart.flatMap((item) => {
    if (item.variant_id !== variantId) return [item]
    if (next <= 0) return []
    if (next > item.available_qty) {
      limited = item
      return [item]
    }
    return [{ ...item, qty: next }]
  })
  return { cart: result, limited: limited as CartItem | null }
}

/** A result whose barcode or SKU equals the scanned term exactly, if any. */
export function findExactMatch(results: Product[], term: string): Product | undefined {
  return results.find((p) =>
    [p.barcode_ean13, p.barcode_internal, p.sku].some((code) => !!code && code === term),
  )
}
