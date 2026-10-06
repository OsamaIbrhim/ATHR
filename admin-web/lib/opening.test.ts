import { describe, expect, it } from 'vitest'
import type { PickedItem } from './items'
import { applyOpeningResults, buildOpeningBody, loadDraft, payloadSignature, saveDraft, totals, validateOpeningLine, type OpeningLine } from './opening'

const item = (id: string): PickedItem => ({ id, sku: id, label: null, name: `صنف ${id}`, barcodes: [], costPrice: null, baseUomId: null, tracked: false, stocked: true, available: 0 })
const line = (id: string, qty = '', cost = '', precision = 0): OpeningLine => ({ item: item(id), qty, cost, costFromItem: false, precision, packQty: 1 })

describe('validateOpeningLine', () => {
  it('asks for quantity and cost', () => {
    expect(validateOpeningLine(line('a'), { needCost: true })).toEqual({ qty: 'اكتب الكمية', cost: 'اكتب التكلفة' })
    expect(validateOpeningLine(line('a', '0', '5'), { needCost: true }).qty).toBe('اكتب الكمية')
  })
  it('accepts a full line, warns on zero cost without blocking', () => {
    expect(validateOpeningLine(line('a', '3', '7.5'), { needCost: true })).toEqual({})
    expect(validateOpeningLine(line('a', '3', '0'), { needCost: true })).toEqual({ warn: 'التكلفة صفر — ستظهر الأرباح غير صحيحة.' })
  })
  it('checks precision per unit', () => {
    expect(validateOpeningLine(line('a', '1.5', '2', 0), { needCost: true }).qty).toMatch(/عددًا صحيحًا/)
    expect(validateOpeningLine(line('a', '1.5', '2', 3), { needCost: true })).toEqual({})
  })
})

describe('totals and body', () => {
  it('sums qty x cost', () => {
    expect(totals([line('a', '2', '10'), line('b', '1.5', '4', 3)])).toEqual({ items: 2, value: 26 })
  })
  it('builds numeric lines and leaves cost out without permission', () => {
    const body = buildOpeningBody('br', 'key-12345678', [line('a', '2', '10')], true)
    expect(body).toEqual({ branch_id: 'br', idempotency_key: 'key-12345678', lines: [{ variant_id: 'a', qty: 2, unit_cost: 10 }] })
    expect(buildOpeningBody('br', 'key-12345678', [line('a', '2', '')], false).lines[0]).toEqual({ variant_id: 'a', qty: 2 })
  })
})

describe('applyOpeningResults', () => {
  it('removes posted lines and keeps rejected ones with their reason', () => {
    const { remaining, posted, rejected } = applyOpeningResults(
      [line('a', '1', '1'), line('b', '1', '1')],
      [{ index: 0, variant_id: 'a', status: 'posted' }, { index: 1, variant_id: 'b', status: 'rejected', message_ar: 'مرفوض' }],
    )
    expect(posted).toBe(1); expect(rejected).toBe(1)
    expect(remaining.map(l => [l.item.id, l.serverError])).toEqual([['b', 'مرفوض']])
  })
})

describe('draft and signature', () => {
  it('round-trips a draft and clears it when empty', () => {
    const data: Record<string, string> = {}
    const storage = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v }, removeItem: (k: string) => { delete data[k] } }
    saveDraft(storage, 'br', [line('a', '2', '3')])
    expect(loadDraft(storage, 'br')).toHaveLength(1)
    saveDraft(storage, 'br', [])
    expect(loadDraft(storage, 'br')).toEqual([])
  })
  it('differs when a line changes', () => {
    const a = payloadSignature(buildOpeningBody('br', 'k', [line('a', '2', '3')], true))
    const b = payloadSignature(buildOpeningBody('br', 'other', [line('a', '2', '3')], true))
    const c = payloadSignature(buildOpeningBody('br', 'k', [line('a', '5', '3')], true))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
