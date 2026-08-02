import { describe, expect, it } from 'vitest'
import { decimalToMinorUnits, minorUnitsToDecimal } from './money-codec'

describe('POS money-codec (SQLite minor-units storage on top of @athr/domain-core Money)', () => {
  it('converts a decimal amount to integer minor units', () => {
    expect(decimalToMinorUnits('19.99')).toBe(1999)
    expect(decimalToMinorUnits(19.99)).toBe(1999)
  })

  it('round-trips minor units back to the original decimal string', () => {
    expect(minorUnitsToDecimal(1999)).toBe('19.99')
    expect(minorUnitsToDecimal(0)).toBe('0.00')
  })

  it('collapses IEEE-754 float noise at the storage boundary (0.1 + 0.2 -> 30 minor units)', () => {
    expect(decimalToMinorUnits(0.1 + 0.2)).toBe(30)
  })

  it('rounds half up at the boundary (100.005 -> 10001 minor units)', () => {
    expect(decimalToMinorUnits(100.005)).toBe(10001)
  })

  it('rejects a value outside the safe SQLite integer range', () => {
    expect(() => decimalToMinorUnits('999999999999999999.99')).toThrow(RangeError)
  })
})
