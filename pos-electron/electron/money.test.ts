import { describe, expect, it } from 'vitest'
import {
  formatMoney,
  lineCents,
  sameMoney,
  toCents,
} from './money'

describe('POS money arithmetic', () => {
  it('rounds decimal strings without binary multiplication', () => {
    expect(toCents('1.005')).toBe(101)
    expect(toCents('-1.005')).toBe(-101)
  })

  it('contains pre-existing binary noise at the cents boundary', () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(sameMoney(0.1 + 0.2, '0.30')).toBe(true)
  })

  it('keeps line totals in integer cents', () => {
    expect(lineCents('10.33', 3)).toBe(3099)
    expect(formatMoney('10.999')).toBe('11.00')
  })

  it('prices fractional quantities exactly, half up per line like the backend', () => {
    // 10.00 x 1.235 kg = 12.35
    expect(lineCents('10.00', 1.235)).toBe(1235)
    // 0.50 x 1.235 = 0.6175 -> 0.62 (a float multiply gives 0.6174999...)
    expect(lineCents('0.50', 1.235)).toBe(62)
    // 10.33 x 1.235 = 12.75755 -> 12.76
    expect(lineCents('10.33', 1.235)).toBe(1276)
    // tax 0.15 x 1.235 = 0.18525 -> 0.19 (rounded on its own, not folded into the price)
    expect(lineCents('0.15', 1.235)).toBe(19)
    // exact half cent rounds up: 0.05 x 0.5 = 0.025 -> 0.03
    expect(lineCents('0.05', 0.5)).toBe(3)
    expect(lineCents('0.05', 0.499)).toBe(2)
    expect(lineCents('19.99', 0.001)).toBe(2)
    expect(lineCents('10.33', 3)).toBe(3099)
  })

  it('agrees with the server total for a mixed decimal invoice', () => {
    // Server: subtotal = sum(round(price x qty)), tax = sum(round(tax x qty)), total = subtotal + tax.
    const lines = [
      { price: '10.33', tax: '1.45', qty: 1.235 },
      { price: '4.75', tax: '0.67', qty: 2 },
    ]
    const subtotal = lines.reduce((sum, l) => sum + lineCents(l.price, l.qty), 0)
    const tax = lines.reduce((sum, l) => sum + lineCents(l.tax, l.qty), 0)
    expect(subtotal).toBe(1276 + 950)
    expect(tax).toBe(179 + 134)
  })

  it('rejects quantities the server would reject', () => {
    expect(() => lineCents('1.00', 1.2345)).toThrow()
    expect(() => lineCents('1.00', -1)).toThrow()
  })
})
