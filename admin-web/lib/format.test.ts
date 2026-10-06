import { describe, expect, it } from 'vitest'
import { formatBytes, formatDate, formatMoney, formatQty, MINUS, parseDecimal, toWesternDigits } from './format'

describe('toWesternDigits / parseDecimal', () => {
  it('converts Arabic-Indic digits and separators', () => {
    expect(toWesternDigits('١٢٣٫٥')).toBe('123.5')
    expect(toWesternDigits('۱۲')).toBe('12')
  })
  it('parses typed and pasted numbers', () => {
    expect(parseDecimal('١٢٫٥')).toBe(12.5)
    expect(parseDecimal('1,250.50')).toBe(1250.5)
    expect(parseDecimal(' -3 ')).toBe(-3)
    expect(parseDecimal(`${MINUS}3`)).toBe(-3)
    expect(parseDecimal('12abc')).toBeNull()
    expect(parseDecimal('')).toBeNull()
    expect(parseDecimal('.5')).toBe(0.5)
  })
})

describe('formatMoney', () => {
  it('always shows two decimals, grouping and the ج.م suffix', () => {
    expect(formatMoney(1250)).toBe('1,250.00 ج.م')
    expect(formatMoney('1250.5')).toBe('1,250.50 ج.م')
    expect(formatMoney(0)).toBe('0.00 ج.م')
  })
  it('uses the real minus sign and explicit plus for deltas', () => {
    expect(formatMoney(-1250)).toBe(`${MINUS}1,250.00 ج.م`)
    expect(formatMoney(300, { signed: true })).toBe('+300.00 ج.م')
    expect(formatMoney(0, { signed: true })).toBe('0.00 ج.م')
    expect(formatMoney(-0.001)).toBe('0.00 ج.م')
  })
  it('can drop the unit and handles missing values', () => {
    expect(formatMoney(5, { unit: false })).toBe('5.00')
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney('abc')).toBe('—')
  })
})

describe('formatQty', () => {
  it('follows the unit precision', () => {
    expect(formatQty(24, { precision: 0 })).toBe('24')
    expect(formatQty('24.000', { precision: 0 })).toBe('24')
    expect(formatQty(1.5, { precision: 3 })).toBe('1.500')
  })
  it('drops trailing noise when precision is unknown', () => {
    expect(formatQty('24.000')).toBe('24')
    expect(formatQty('24.500')).toBe('24.5')
    expect(formatQty(1234)).toBe('1,234')
  })
  it('signs deltas and appends the unit', () => {
    expect(formatQty(5, { signed: true })).toBe('+5')
    expect(formatQty(-3, { signed: true })).toBe(`${MINUS}3`)
    expect(formatQty(1.5, { precision: 3, unit: 'كجم' })).toBe('1.500 كجم')
    expect(formatQty(0, { signed: true })).toBe('0')
    expect(formatQty(undefined)).toBe('—')
  })
})

describe('formatDate', () => {
  it('uses Western digits only', () => {
    const text = formatDate('2026-09-30T10:15:00Z', { time: true })
    expect(text).toMatch(/\d/)
    expect(text).not.toMatch(/[٠-٩]/)
    expect(formatDate(null)).toBe('—')
    expect(formatDate('not a date')).toBe('—')
  })
})

describe('formatBytes', () => {
  it('picks a readable unit', () => {
    expect(formatBytes(500)).toBe('500 بايت')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 ميجا')
  })
})
