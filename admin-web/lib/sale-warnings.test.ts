import { describe, expect, it } from 'vitest'
import { saleWarningCodes, saleWarningLabel } from './sale-warnings'

describe('sale reconciliation warnings', () => {
  it('provides an operator-facing label for known warnings', () => {
    expect(saleWarningLabel('PRICE_VARIANCE')).toContain('السعر')
    expect(saleWarningLabel('LATE_SYNC')).toContain('الوردية')
  })

  it('keeps unknown future warning codes visible', () => {
    expect(saleWarningLabel('FUTURE_WARNING')).toBe('FUTURE_WARNING')
  })

  it('normalizes malformed API values to an empty list', () => {
    expect(saleWarningCodes(null)).toEqual([])
    expect(saleWarningCodes(['PRICE_VARIANCE', 3])).toEqual([
      'PRICE_VARIANCE',
    ])
  })
})
