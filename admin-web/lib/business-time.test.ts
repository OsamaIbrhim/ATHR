import { describe, expect, it } from 'vitest'
import { businessDate, businessMonthRange } from './business-time'

describe('business dates', () => {
  it('uses Cairo date rather than UTC around local midnight', () => {
    const now = new Date('2026-07-23T22:30:00.000Z')
    expect(businessDate(now, 'Africa/Cairo')).toBe('2026-07-24')
  })

  it('builds the current Cairo month range', () => {
    const now = new Date('2026-07-31T22:30:00.000Z')
    expect(businessMonthRange(now, 'Africa/Cairo')).toEqual({
      from: '2026-08-01',
      to: '2026-08-01',
    })
  })
})
