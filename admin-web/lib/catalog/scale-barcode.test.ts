import { describe, expect, it } from 'vitest'
import { describeLabel, validateScaleBarcode, type ScaleBarcodeSettings } from './scale-barcode'

const base: ScaleBarcodeSettings = {
  enabled: true, prefixes: ['20', '21'], item_digits: 5, value: 'weight', decimals: 3, price_includes_tax: true,
}

describe('scale barcode settings', () => {
  it('accepts the default layout', () => {
    expect(validateScaleBarcode(base)).toEqual([])
  })

  it('rejects bad prefixes, digit counts and decimals', () => {
    expect(validateScaleBarcode({ ...base, prefixes: [] })).toHaveLength(1)
    expect(validateScaleBarcode({ ...base, prefixes: ['2', '200'] })).toHaveLength(1)
    expect(validateScaleBarcode({ ...base, item_digits: 0 })).toHaveLength(1)
    expect(validateScaleBarcode({ ...base, decimals: 5 })).toHaveLength(1)
  })

  it('describes how the label is split', () => {
    expect(describeLabel(base)).toContain('كود الصنف (5)')
    expect(describeLabel(base)).toContain('الوزن (5، منها 3 عشرية)')
    expect(describeLabel({ ...base, value: 'price', decimals: 2 })).toContain('السعر (5، منها 2 عشرية)')
  })
})
