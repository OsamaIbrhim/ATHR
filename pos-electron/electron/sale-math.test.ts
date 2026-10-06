import { describe, expect, it } from 'vitest'
import { cleanDiscount, discountLimitFor, exceedsDiscountLimit, hasAnyDiscount, lineWithoutTaxRate, priceCart } from './sale-math'
import { lineCents } from './money'

const line = (over: Record<string, unknown> = {}) => ({
  variant_id: 'v1',
  qty: 1,
  unit_price: 100,
  unit_tax: 14,
  tax_rate: '14',
  tax_mode: 'exclusive',
  ...over,
})

describe('priceCart', () => {
  it('keeps the quoted amounts of a sale without discounts (same as the old line arithmetic)', () => {
    const lines = [line({ qty: 1.235, unit_price: 10.33, unit_tax: 1.45 }), line({ variant_id: 'v2', qty: 3, unit_price: 19.99, unit_tax: 2.8 })]
    const priced = priceCart(lines)
    const net = lines.reduce((sum, l) => sum + lineCents(l.unit_price, l.qty), 0) / 100
    const tax = lines.reduce((sum, l) => sum + lineCents(l.unit_tax, l.qty), 0) / 100
    expect(priced.subtotal).toBe(net)
    expect(priced.tax).toBe(tax)
    expect(priced.discount).toBe(0)
    expect(priced.total).toBe(Math.round((net + tax) * 100) / 100)
  })

  it('takes a percent line discount off the price the cashier sees and recomputes the tax', () => {
    const exclusive = priceCart([line({ discount: { type: 'percent', value: 10 } })])
    expect(exclusive).toMatchObject({ subtotal: 100, discount: 10, tax: 12.6, total: 102.6 })
    const inclusive = priceCart([line({ tax_mode: 'inclusive', discount: { type: 'percent', value: 10 } })])
    expect(inclusive).toMatchObject({ discount: 10, tax: 12.6, total: 102.6 })
  })

  it('spreads an invoice discount over the lines and totals it exactly', () => {
    const priced = priceCart([line(), line({ variant_id: 'v2', unit_price: 50, unit_tax: 7 })], { type: 'amount', value: 20 })
    expect(priced).toMatchObject({ subtotal: 150, discount: 20, tax: 18.2, total: 148.2 })
    expect(priced.lines.reduce((sum, l) => sum + l.discount, 0)).toBeCloseTo(20, 2)
  })

  it('never takes more than the line is worth', () => {
    expect(priceCart([line({ discount: { type: 'amount', value: 500 } })]).total).toBe(0)
  })
})

describe('discount policy', () => {
  const cart = priceCart([line({ discount: { type: 'percent', value: 15 } })])
  it('flags a discount above the limit and accepts one at the limit', () => {
    expect(exceedsDiscountLimit(cart, 10)).toBe(true)
    expect(exceedsDiscountLimit(cart, 15)).toBe(false)
    expect(exceedsDiscountLimit(priceCart([line()]), 0)).toBe(false)
  })
  it('lets a branch manager override and holds a cashier to the tenant limit', () => {
    expect(discountLimitFor('cashier', 10)).toBe(10)
    expect(discountLimitFor('branch_manager', 10)).toBe(100)
  })
  it('knows when a discount is involved and which lines cannot take one', () => {
    expect(hasAnyDiscount([line()])).toBe(false)
    expect(hasAnyDiscount([line()], { type: 'amount', value: 1 })).toBe(true)
    expect(lineWithoutTaxRate([line()])).toBeNull()
    expect(lineWithoutTaxRate([line({ tax_rate: null })])?.variant_id).toBe('v1')
  })
  it('cleans what the cashier typed', () => {
    expect(cleanDiscount('percent', '12,5')).toEqual({ type: 'percent', value: 12.5 })
    expect(cleanDiscount('percent', '101')).toBeNull()
    expect(cleanDiscount('amount', '')).toBeNull()
    expect(cleanDiscount('amount', '-3')).toBeNull()
  })
})
