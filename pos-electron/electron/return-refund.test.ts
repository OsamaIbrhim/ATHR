import { describe, expect, it } from 'vitest'
import { refundForLine } from './return-refund'

describe('refundForLine', () => {
  it('refunds the price and tax of the returned units when nothing was discounted', () => {
    const line = { qty: 3, unit_price: 100, unit_tax: 14, discount_amount: 0, tax_amount: 42 }
    expect(refundForLine(line, 0, 1)).toEqual({ net: 100, tax: 14, gross: 114 })
  })

  it('refunds what was paid after a discount, not the shelf price', () => {
    // 100 + 14% tax, 10% off: net 90, tax 12.60, the customer paid 102.60.
    const line = { qty: 1, unit_price: 100, unit_tax: 14, discount_amount: 10, tax_amount: 12.6 }
    expect(refundForLine(line, 0, 1)).toEqual({ net: 90, tax: 12.6, gross: 102.6 })
  })

  it('returned in several goes, the parts add up to exactly the line', () => {
    const line = { qty: 3, unit_price: 33.33, discount_amount: 0.01, tax_amount: 14 }
    const parts = [0, 1, 2].map((returned) => refundForLine(line, returned, 1))
    const cents = (pick: (part: ReturnType<typeof refundForLine>) => number) =>
      Math.round(parts.reduce((sum, part) => sum + pick(part), 0) * 100)
    expect(cents((part) => part.net)).toBe(9998) // 99.99 - 0.01
    expect(cents((part) => part.tax)).toBe(1400)
  })

  it('falls back to the quoted tax when the line has no stored tax amount', () => {
    expect(refundForLine({ qty: 2, unit_price: 50, unit_tax: 7 }, 0, 1).tax).toBe(7)
  })
})
