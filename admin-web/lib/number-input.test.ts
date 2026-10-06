import { describe, expect, it } from 'vitest'
import { decimalsOf, numberOf, sanitizeNumberText } from './number-input'

describe('sanitizeNumberText', () => {
  it('converts Arabic-Indic digits and the Arabic decimal mark', () => {
    expect(sanitizeNumberText('١٢٫٥', { precision: 3 })).toBe('12.5')
  })
  it('cuts decimals past the precision and forbids them for pieces', () => {
    expect(sanitizeNumberText('1.23456', { precision: 3 })).toBe('1.234')
    expect(sanitizeNumberText('3.5', { precision: 0 })).toBe('35')
  })
  it('keeps a minus only when signed values are allowed and only at the start', () => {
    expect(sanitizeNumberText('-4', { precision: 0, allowSign: true })).toBe('-4')
    expect(sanitizeNumberText('-4', { precision: 0 })).toBe('4')
    expect(sanitizeNumberText('4-2', { precision: 0, allowSign: true })).toBe('42')
  })
  it('drops letters and a second decimal point', () => {
    expect(sanitizeNumberText('a1.2.3b', { precision: 3 })).toBe('1.23')
  })
  it('starts a bare decimal point with a zero', () => {
    expect(sanitizeNumberText('.5', { precision: 2 })).toBe('0.5')
  })
})

describe('numberOf / decimalsOf', () => {
  it('reads empty and sign-only text as null', () => {
    expect(numberOf('')).toBeNull()
    expect(numberOf('-')).toBeNull()
    expect(numberOf('-2.5')).toBe(-2.5)
  })
  it('counts decimals', () => {
    expect(decimalsOf('1.50')).toBe(2)
    expect(decimalsOf('7')).toBe(0)
  })
})
