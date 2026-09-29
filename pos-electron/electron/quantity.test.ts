import { describe, expect, it } from 'vitest'
import {
  addQuantity,
  isValidQuantity,
  quantityToMilli,
  roundMilli,
  subtractQuantity,
  sumQuantities,
} from './quantity'

describe('POS quantities', () => {
  it('reads exact thousandths', () => {
    expect(quantityToMilli(1.235)).toBe(1235)
    expect(quantityToMilli(0.001)).toBe(1)
    expect(quantityToMilli(12)).toBe(12_000)
    expect(() => quantityToMilli(1.2345)).toThrow(/3 places/)
    expect(() => quantityToMilli(-1)).toThrow()
    expect(() => quantityToMilli(1e-7)).toThrow()
    expect(() => quantityToMilli(Number.NaN)).toThrow()
  })

  it('validates against the unit precision', () => {
    expect(isValidQuantity(3, 0)).toBe(true)
    expect(isValidQuantity(1.5, 0)).toBe(false)
    expect(isValidQuantity(1.5, 1)).toBe(true)
    expect(isValidQuantity(1.25, 1)).toBe(false)
    expect(isValidQuantity(1.235, 3)).toBe(true)
    expect(isValidQuantity(1.2345, 3)).toBe(false)
    expect(isValidQuantity(0, 3)).toBe(false)
    expect(isValidQuantity(-1, 3)).toBe(false)
    expect(isValidQuantity(100_000_000, 3)).toBe(false)
    expect(isValidQuantity('2', 3)).toBe(false)
  })

  it('adds and subtracts without float noise', () => {
    expect(addQuantity(0.1, 0.2)).toBe(0.3)
    expect(subtractQuantity(2.3, 1.1)).toBe(1.2)
    expect(sumQuantities([0.1, 0.2, 0.7])).toBe(1)
  })

  it('rounds thousandths half up to the unit step', () => {
    expect(roundMilli(1234, 3)).toBe(1234)
    expect(roundMilli(1235, 2)).toBe(1240)
    expect(roundMilli(1234, 2)).toBe(1230)
    expect(roundMilli(1500, 0)).toBe(2000)
    expect(roundMilli(1499, 0)).toBe(1000)
  })
})
