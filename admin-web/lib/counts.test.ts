import { describe, expect, it } from 'vitest'
import { applyResults, bumpLocal, buildPostBody, emptyCounterState, isBarcodeLike, postBlockReason, scopeLabel, type VariantLite } from './counts'

const v: VariantLite = { id: 'v1', sku: 'S1', label: null, name_ar: 'شاي', name_en: null }
const counted = (over: Record<string, unknown> = {}) => ({ entry_id: 'e1', status: 'counted', variant: v, pack_qty: 1, added: 1, counted_total: 5, counted_by_me: 2, barcode: '111', ...over })

describe('applyResults', () => {
  it('records the counted item and its totals as the last card', () => {
    const s = applyResults(emptyCounterState(), [counted()], 100)
    expect(s.mine.get('v1')).toMatchObject({ mine: 2, total: 5 })
    expect(s.last).toMatchObject({ kind: 'counted', mine: 2, total: 5, added: 1 })
  })
  it('drops an item from my list when my total returns to zero (undo)', () => {
    const s1 = applyResults(emptyCounterState(), [counted()], 1)
    const s2 = applyResults(s1, [counted({ entry_id: 'e2', added: -2, counted_by_me: 0, counted_total: 3 })], 2)
    expect(s2.mine.has('v1')).toBe(false)
  })
  it('keeps unknown barcodes counted and shows the code', () => {
    const s = applyResults(emptyCounterState(), [{ entry_id: 'e', status: 'unknown_barcode', barcode: '999' }], 1)
    expect(s.unknownScans).toBe(1)
    expect(s.last).toEqual({ kind: 'unknown', code: '999' })
  })
  it('flags out of scope and problems; ignores duplicates of an already recorded entry', () => {
    expect(applyResults(emptyCounterState(), [{ entry_id: 'e', status: 'out_of_scope', barcode: '5', variant: v }], 1).last).toMatchObject({ kind: 'out_of_scope', entryId: 'e' })
    expect(applyResults(emptyCounterState(), [{ entry_id: 'e', status: 'tracked_not_supported' }], 1).last).toEqual({ kind: 'problem', message: 'الأصناف المتتبَّعة لا تُجرد هنا حاليًا.' })
    const before = applyResults(emptyCounterState(), [counted()], 1)
    expect(applyResults(before, [{ entry_id: 'e1', status: 'duplicate' }], 2)).toEqual(before)
  })
})

describe('bumpLocal', () => {
  it('adds, sets and never goes below zero', () => {
    let s = bumpLocal(emptyCounterState(), v, { add: 1 }, 1)
    s = bumpLocal(s, v, { add: 1 }, 2)
    expect(s.mine.get('v1')?.mine).toBe(2)
    s = bumpLocal(s, v, { set: 10 }, 3)
    expect(s.mine.get('v1')).toMatchObject({ mine: 10, total: 10 })
    s = bumpLocal(s, v, { add: -50 }, 4)
    expect(s.mine.has('v1')).toBe(false)
  })
})

describe('post rules', () => {
  it('builds the post body for each choice with per-row overrides', () => {
    expect(buildPostBody(null, new Set())).toEqual({})
    expect(buildPostBody('ignore', new Set(['a']))).toEqual({ uncounted: 'ignore', zero_variant_ids: ['a'] })
    expect(buildPostBody('zero', new Set(['b']))).toEqual({ uncounted: 'zero', keep_variant_ids: ['b'] })
    expect(buildPostBody('zero', new Set())).toEqual({ uncounted: 'zero' })
  })
  it('explains why posting is blocked', () => {
    expect(postBlockReason({ canPost: false, countedItems: 3, uncountedItems: 0, choice: null })).toBe('الترحيل يقوم به مسؤول المخزون.')
    expect(postBlockReason({ canPost: true, countedItems: 0, uncountedItems: 0, choice: null })).toBe('لم يُعدّ أي صنف بعد.')
    expect(postBlockReason({ canPost: true, countedItems: 3, uncountedItems: 2, choice: null })).toBe('اختر ما يحدث للأصناف التي لم تُعدّ أولًا.')
    expect(postBlockReason({ canPost: true, countedItems: 3, uncountedItems: 2, choice: 'ignore' })).toBe('')
  })
})

describe('helpers', () => {
  it('recognises scanner input and labels scopes', () => {
    expect(isBarcodeLike('6221234567890')).toBe(true)
    expect(isBarcodeLike('شاي')).toBe(false)
    expect(isBarcodeLike('123')).toBe(false)
    expect(scopeLabel({ type: 'all' })).toBe('كل الأصناف')
    expect(scopeLabel({ type: 'product_type', name: 'ملابس' })).toBe('نوع: ملابس')
  })
})
