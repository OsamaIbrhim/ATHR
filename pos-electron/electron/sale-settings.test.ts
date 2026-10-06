import { describe, expect, it } from 'vitest'
import { DEFAULT_POS_SETTINGS, parsePosSettings } from './sale-settings'

describe('parsePosSettings', () => {
  it('uses the defaults for nothing, junk or an old server without sale settings', () => {
    expect(parsePosSettings(undefined)).toEqual(DEFAULT_POS_SETTINGS)
    expect(parsePosSettings('x')).toEqual(DEFAULT_POS_SETTINGS)
    expect(parsePosSettings({ scale_barcode: { enabled: false } })).toEqual(DEFAULT_POS_SETTINGS)
  })

  it('reads the tenant values', () => {
    const parsed = parsePosSettings({
      sales: { payment_methods: ['cash', 'bank_transfer', 'bogus'], return_window_days: 0, max_discount_percent: 25 },
      receipt: { store_name: ' متجر النور ', footer: 'شكرًا', show_tax_breakdown: false, show_branding: false },
    })
    expect(parsed.sales).toEqual({ payment_methods: ['cash', 'bank_transfer'], return_window_days: 0, max_discount_percent: 25 })
    expect(parsed.receipt).toEqual({ store_name: 'متجر النور', footer: 'شكرًا', show_tax_breakdown: false, show_branding: false })
  })

  it('falls back per field and never throws', () => {
    const parsed = parsePosSettings({ sales: { payment_methods: [], return_window_days: -1, max_discount_percent: 101 } })
    expect(parsed.sales).toEqual(DEFAULT_POS_SETTINGS.sales)
  })
})
