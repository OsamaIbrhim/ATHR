import { describe, expect, it } from 'vitest'
import type { PickedItem } from './items'
import { adjustmentTotals, afterOf, buildAdjustmentBody, documentActions, lineErrorFrom, progressStep, validateAdjustmentLine, type AdjustmentLine } from './adjustments'

const item: PickedItem = { id: 'v1', sku: 'S', label: null, name: 'x', barcodes: [], costPrice: null, baseUomId: null, tracked: false, stocked: true, available: 5 }
const line = (p: Partial<AdjustmentLine> = {}): AdjustmentLine => ({ item, qty: '-2', reason: 'damaged', note: '', precision: 0, onHand: 5, unitCost: 10, ...p })

describe('validateAdjustmentLine', () => {
  it('accepts a complete line', () => expect(validateAdjustmentLine(line())).toEqual({}))
  it('needs a non-zero quantity, a reason and a note for "other"', () => {
    expect(validateAdjustmentLine(line({ qty: '' })).qty).toBe('اكتب كمية أكبر أو أقل من صفر')
    expect(validateAdjustmentLine(line({ qty: '0' })).qty).toBeDefined()
    expect(validateAdjustmentLine(line({ reason: '' })).reason).toBe('اختر السبب')
    expect(validateAdjustmentLine(line({ reason: 'other', note: ' ' })).note).toBe('اكتب ملاحظة')
    expect(validateAdjustmentLine(line({ reason: 'other', note: 'سبب' }))).toEqual({})
  })
  it('respects unit precision', () => {
    expect(validateAdjustmentLine(line({ qty: '-1.5' })).qty).toMatch(/عددًا صحيحًا/)
    expect(validateAdjustmentLine(line({ qty: '-1.5', precision: 3 }))).toEqual({})
  })
})

describe('totals', () => {
  it('splits increases and decreases and counts lines going below zero', () => {
    const t = adjustmentTotals([line({ qty: '3' }), line({ qty: '-8' })])
    expect(t).toMatchObject({ increase: 30, decrease: 80, net: -50, negatives: 1, valueKnown: true })
    expect(afterOf(line({ qty: '-8' }))).toBe(-3)
  })
  it('value is unknown without costs', () => {
    expect(adjustmentTotals([line({ unitCost: null })]).valueKnown).toBe(false)
  })
})

describe('body, actions, progress', () => {
  it('builds signed numeric lines and trims notes', () => {
    expect(buildAdjustmentBody([line({ reason: 'other', note: ' كسر ' })], ' ملاحظة ')).toEqual({
      note: 'ملاحظة', lines: [{ variant_id: 'v1', qty_delta: -2, reason_code: 'other', note: 'كسر' }],
    })
  })
  it('follows the action table of the spec (self-approval allowed, no submit step)', () => {
    const all = { request: true, approve: true, post: true }
    expect(documentActions('draft', all)).toMatchObject({ edit: true, approve: true, post: false, cancel: true })
    expect(documentActions('approved', all)).toMatchObject({ edit: false, approve: false, post: true, cancel: true })
    expect(documentActions('posted', all)).toMatchObject({ edit: false, approve: false, post: false, cancel: false })
    expect(documentActions('draft', { request: true, approve: false, post: false }).waitingApproval).toBe(true)
    expect(documentActions('approved', { request: true, approve: true, post: false }).waitingPost).toBe(true)
  })
  it('maps status to a strip position', () => {
    expect([progressStep('draft'), progressStep('approved'), progressStep('posted')]).toEqual([1, 2, 3])
  })
  it('reads the failing line index from a server error', () => {
    expect(lineErrorFrom({ data: { line_index: 2 }, message: 'm' })).toEqual({ index: 2, message: 'm' })
    expect(lineErrorFrom({ message: 'm' })).toBeNull()
  })
})
