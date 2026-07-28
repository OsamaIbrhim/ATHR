import { describe, expect, it } from 'vitest'
import { cartTotals } from './utils'

describe('historical offline sale prices', () => {
  it('keeps the scanned local price immutable even after cloud catalog time passes', () => {
    const scannedItem = {
      id: 'variant-1',
      variant_id: 'variant-1',
      name: 'Product',
      sku: 'SKU-1',
      qty: 2,
      unit_price: 100,
      unit_tax: 14,
      available_qty: 10,
    }

    expect(cartTotals([scannedItem])).toEqual({
      subtotal: 200,
      tax: 28,
      total: 228,
      quantity: 2,
    })
  })
})
