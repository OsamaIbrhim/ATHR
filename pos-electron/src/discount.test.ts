import { describe, expect, it } from 'vitest'
import { previewDiscount, withDiscount } from './discount'
import type { CartItem } from './types'

const item = (over: Partial<CartItem> = {}): CartItem =>
  ({ id: 'v1', variant_id: 'v1', sku: 'A', name: 'قميص', qty: 1, unit_price: 100, unit_tax: 14, available_qty: 5, tax_rate: '14', tax_mode: 'exclusive', ...over }) as CartItem

describe('previewDiscount', () => {
  it('prices a line discount and allows it up to the limit', () => {
    const preview = previewDiscount([item()], null, { kind: 'line', variantId: 'v1' }, { type: 'percent', value: 10 }, 10)
    expect(preview).toEqual({ error: null, discount: 10, total: 102.6 })
  })

  it('stops a discount above the limit, for a line and for the invoice', () => {
    const above = { type: 'percent', value: 11 } as const
    expect(previewDiscount([item()], null, { kind: 'line', variantId: 'v1' }, above, 10).error).toContain('10%')
    expect(previewDiscount([item()], null, { kind: 'invoice' }, above, 10).error).toContain('10%')
    expect(previewDiscount([item()], null, { kind: 'invoice' }, above, 100).error).toBeNull()
  })

  it('counts the line discount and the invoice discount together against the limit', () => {
    const lines = [item({ discount: { type: 'percent', value: 6 } })]
    expect(previewDiscount(lines, null, { kind: 'invoice' }, { type: 'percent', value: 6 }, 10).error).not.toBeNull()
    expect(previewDiscount(lines, null, { kind: 'invoice' }, { type: 'percent', value: 3 }, 10).error).toBeNull()
  })

  it('asks for a catalog sync when a row has no tax rate yet', () => {
    const preview = previewDiscount([item({ tax_rate: null })], null, { kind: 'line', variantId: 'v1' }, { type: 'amount', value: 5 }, 10)
    expect(preview.error).toContain('مزامنة الكتالوج')
  })

  it('removing a discount is always allowed', () => {
    const lines = [item({ tax_rate: null, discount: { type: 'amount', value: 5 } })]
    const preview = previewDiscount(lines, null, { kind: 'line', variantId: 'v1' }, null, 0)
    expect(preview).toEqual({ error: null, discount: 0, total: 114 })
  })
})

describe('withDiscount', () => {
  it('sets a line discount without touching the other lines', () => {
    const lines = [item(), item({ variant_id: 'v2', id: 'v2' })]
    const next = withDiscount(lines, null, { kind: 'line', variantId: 'v2' }, { type: 'amount', value: 3 })
    expect(next.items[0]!.discount).toBeUndefined()
    expect(next.items[1]!.discount).toEqual({ type: 'amount', value: 3 })
  })
})
