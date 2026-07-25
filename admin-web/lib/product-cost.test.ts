import { describe, expect, it } from 'vitest'
import { parseProductCost } from './product-cost'

describe('parseProductCost', () => {
  it('rejects a blank cost instead of silently converting it to zero', () => {
    expect(parseProductCost('', false)).toEqual({
      ok: false,
      error: 'أدخل سعر التكلفة صراحةً.',
    })
  })

  it('requires an explicit confirmation for a zero cost', () => {
    expect(parseProductCost('0', false).ok).toBe(false)
    expect(parseProductCost('0.00', true)).toEqual({ ok: true, value: 0 })
  })

  it('accepts a valid two-decimal cost and rejects malformed values', () => {
    expect(parseProductCost('125.50', false)).toEqual({ ok: true, value: 125.5 })
    expect(parseProductCost('12.345', false).ok).toBe(false)
    expect(parseProductCost('not-a-number', false).ok).toBe(false)
  })
})
