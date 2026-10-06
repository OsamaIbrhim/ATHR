import { describe, expect, it } from 'vitest'
import { applyPlanLimit, DuplicateRegistry, planChunks, rowBytes } from './chunking'
import type { ImportRow } from './rows'

const row = (n: number, extra: Partial<ImportRow> = {}): ImportRow => ({ row_ref: n, sku: `S${n}`, name: `منتج ${n}`, price: '10', ...extra })

describe('planChunks', () => {
  it('splits at 2000 rows', () => {
    const rows = Array.from({ length: 4500 }, (_, i) => row(i + 2))
    const chunks = planChunks(rows, { maxBytes: 100_000_000 })
    expect(chunks.map(c => c.length)).toEqual([2000, 2000, 500])
  })
  it('splits by size too, keeping order and never dropping a row', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(i + 2, { name: 'x'.repeat(1000) }))
    const chunks = planChunks(rows, { maxBytes: 10_000 })
    expect(chunks.length).toBeGreaterThan(4)
    for (const chunk of chunks) expect(chunk.reduce((n, r) => n + rowBytes(r), 0)).toBeLessThanOrEqual(10_000)
    expect(chunks.flat().map(r => r.row_ref)).toEqual(rows.map(r => r.row_ref))
  })
  it('puts one oversized row alone instead of looping', () => {
    const chunks = planChunks([row(2, { name: 'y'.repeat(5000) }), row(3)], { maxBytes: 1000 })
    expect(chunks.map(c => c.length)).toEqual([1, 1])
  })
  it('returns no chunks for no rows', () => {
    expect(planChunks([])).toEqual([])
  })
})

describe('DuplicateRegistry', () => {
  it('flags repeated SKUs and barcodes, first occurrence wins, across files', () => {
    const reg = new DuplicateRegistry()
    expect(reg.check(row(2, { sku: 'A', barcode: '111;222' }), 'الصف 2')).toBeNull()
    expect(reg.check(row(3, { sku: 'S2', barcode: '222' }), 'الصف 3')).toMatchObject({
      code: 'IMPORT_DUPLICATE_BARCODE_IN_FILE', message_ar: 'الباركود 222 مكرر في الملف (الصف 2).',
    })
    expect(reg.check(row(4, { sku: 'S2' }), 'الصف 4')).toBeNull()
    expect(reg.check(row(5, { sku: 'S2' }), 'الملف الثاني، الصف 5')).toMatchObject({
      code: 'IMPORT_DUPLICATE_SKU_IN_FILE', message_ar: 'SKU S2 مكرر في الملف (الصف 4).',
    })
  })
  it('uses the first barcode as the SKU when the SKU is empty', () => {
    const reg = new DuplicateRegistry()
    expect(reg.check({ row_ref: 2, barcode: '999', name: 'a' }, 'الصف 2')).toBeNull()
    expect(reg.check({ row_ref: 3, sku: '999', name: 'b' }, 'الصف 3')?.code).toBe('IMPORT_DUPLICATE_SKU_IN_FILE')
  })
})

describe('applyPlanLimit', () => {
  const rows = (...statuses: Array<'ready' | 'failed' | 'skipped'>) => statuses.map(status => ({ status }))
  it('lets the first `remaining` ready rows through and marks the rest out of plan', () => {
    const out = applyPlanLimit(rows('ready', 'failed', 'ready', 'ready', 'skipped'), 2)
    expect(out.map(r => r.status)).toEqual(['ready', 'failed', 'ready', 'out_of_plan', 'skipped'])
  })
  it('does nothing when unlimited, and blocks everything at zero', () => {
    expect(applyPlanLimit(rows('ready'), null).map(r => r.status)).toEqual(['ready'])
    expect(applyPlanLimit(rows('ready', 'ready'), 0).map(r => r.status)).toEqual(['out_of_plan', 'out_of_plan'])
  })
})
