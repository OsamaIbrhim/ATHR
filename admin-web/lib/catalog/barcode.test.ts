import { describe, expect, it } from 'vitest'
import { formatQuantity, hasAtMostDecimals, packQtyDecimals, packQtyStep, parseBarcode } from './barcode'

describe('barcode rules', () => {
  it('validates the code format', () => {
    expect(parseBarcode({ code: '6221031', pack_qty: '1', kind: 'standard' })).toMatchObject({ ok: true, code: '6221031' })
    expect(parseBarcode({ code: 'a b', pack_qty: '1', kind: 'standard' })).toMatchObject({ ok: false })
    expect(parseBarcode({ code: 'x'.repeat(65), pack_qty: '1', kind: 'standard' })).toMatchObject({ ok: false })
  })

  it('limits pack quantity decimals by the unit precision', () => {
    expect(parseBarcode({ code: 'A1', pack_qty: '6', kind: 'standard' }, 0)).toMatchObject({ ok: true, pack_qty: 6 })
    expect(parseBarcode({ code: 'A1', pack_qty: '1.5', kind: 'standard' }, 0)).toMatchObject({ ok: false })
    expect(parseBarcode({ code: 'A1', pack_qty: '1.5', kind: 'standard' }, 3)).toMatchObject({ ok: true, pack_qty: 1.5 })
    expect(parseBarcode({ code: 'A1', pack_qty: '1.2345', kind: 'standard' }, 6)).toMatchObject({ ok: false })
    expect(parseBarcode({ code: 'A1', pack_qty: '0', kind: 'standard' }, 0)).toMatchObject({ ok: false })
  })

  it('forces pack_qty 1 for a scale item code', () => {
    expect(parseBarcode({ code: '2100001', pack_qty: '1', kind: 'scale_plu' })).toMatchObject({ ok: true })
    expect(parseBarcode({ code: '2100001', pack_qty: '2', kind: 'scale_plu' })).toMatchObject({ ok: false })
  })

  it('derives the input step and formats quantities', () => {
    expect(packQtyDecimals(6)).toBe(3)
    expect(packQtyStep(0)).toBe('1')
    expect(packQtyStep(3)).toBe('0.001')
    expect(hasAtMostDecimals('2.50', 1)).toBe(false)
    expect(formatQuantity('1.250', 3)).toBe('1.25')
    expect(formatQuantity(3, 0)).toBe('3')
    expect(formatQuantity(undefined)).toBe('—')
  })
})
