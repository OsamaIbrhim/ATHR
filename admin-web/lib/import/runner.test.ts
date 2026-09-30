import { describe, expect, it, vi } from 'vitest'
import { DuplicateRegistry } from './chunking'
import { dryRunAll, importChunks, precheckDuplicates, problemText, tabCounts, type ChunkResponse, type ImportRequest, type Poster } from './runner'
import type { ImportRow } from './rows'

const row = (n: number, extra: Partial<ImportRow> = {}): ImportRow => ({ row_ref: n, sku: `S${n}`, name: `منتج ${n}`, price: '10', ...extra })

/** A fake server: a limit on new products, names under 2 chars fail, SKU "OLD" exists. */
function fakeServer(remaining: number | null): Poster {
  let left = remaining
  return async (req: ImportRequest): Promise<ChunkResponse> => {
    let slots = left
    const rows = req.rows.map(r => {
      if ((r.name ?? '').length < 2) return { row_ref: r.row_ref, sku: r.sku ?? null, status: 'failed' as const, errors: [{ code: 'IMPORT_NAME_REQUIRED', message_ar: 'اسم المنتج فارغ.' }], warnings: [] }
      if (r.sku === 'OLD') return { row_ref: r.row_ref, sku: 'OLD', status: 'skipped' as const, errors: [{ code: 'SKU_EXISTS', message_ar: 'SKU موجود بالفعل — لن يتغير.' }], warnings: [] }
      if (slots !== null) {
        if (slots <= 0) return { row_ref: r.row_ref, sku: r.sku ?? null, status: 'failed' as const, errors: [{ code: 'ENTITLEMENT_LIMIT_REACHED', message_ar: 'تجاوز حد الباقة.' }], warnings: [] }
        slots -= 1
      }
      return { row_ref: r.row_ref, sku: r.sku ?? null, status: req.dry_run ? 'ready' as const : 'created' as const, errors: [], warnings: [] }
    })
    if (!req.dry_run) left = slots
    return { plan_limit: { limit: null, current: 0, remaining: left }, summary: { opening_quantities: 0 }, rows }
  }
}

describe('precheckDuplicates', () => {
  it('rejects repeats locally with the Arabic sentence and keeps the first occurrence', () => {
    const { send, rejected } = precheckDuplicates([row(2, { sku: 'A' }), row(3, { sku: 'A' })], new DuplicateRegistry(), '')
    expect(send.map(r => r.row_ref)).toEqual([2])
    expect(rejected[0]).toMatchObject({ row_ref: 3, status: 'failed' })
    expect(problemText(rejected[0])).toBe('SKU A مكرر في الملف (الصف 2).')
  })
  it('labels rows of an earlier file', () => {
    const registry = new DuplicateRegistry()
    precheckDuplicates([row(2, { sku: 'A' })], registry, 'الملف الأول، ')
    const { rejected } = precheckDuplicates([row(2, { sku: 'A' })], registry.clone(), 'الملف الثاني، ')
    expect(problemText(rejected[0])).toContain('الملف الأول، الصف 2')
  })
})

describe('dryRunAll', () => {
  it('reports per row across chunks and applies the plan limit over all of them', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(i + 2))
    const post = vi.fn(fakeServer(3))
    // Force one row per chunk to prove the limit is applied across chunks, not per chunk.
    const { results, planLimit } = await dryRunAll({ rows: rows.map(r => ({ ...r, name: r.name + 'x'.repeat(400_000) })), post, priceTaxMode: 'inclusive' })
    expect(post.mock.calls.length).toBeGreaterThan(1)
    expect(planLimit?.remaining).toBe(3)
    expect(results.map(r => r.status)).toEqual(['ready', 'ready', 'ready', 'out_of_plan', 'out_of_plan'])
    expect(tabCounts(results)).toMatchObject({ ready: 3, outOfPlan: 2, errors: 0 })
  })
  it('merges client-side rejections in file order and sends the tax mode and branch', async () => {
    const post = vi.fn(fakeServer(null))
    const { results } = await dryRunAll({ rows: [row(2), row(4)], rejected: [{ row_ref: 3, sku: 'Z', name: 'z', status: 'failed', errors: [{ code: 'X', message_ar: 'مكرر' }], warnings: [] }], post, priceTaxMode: 'exclusive', branchId: 'br' })
    expect(results.map(r => r.row_ref)).toEqual([2, 3, 4])
    expect(post.mock.calls[0][0]).toMatchObject({ dry_run: true, price_tax_mode: 'exclusive', branch_id: 'br', on_existing_sku: 'skip' })
    expect(tabCounts(results)).toMatchObject({ errors: 1, ready: 2 })
  })
  it('counts skipped rows and names empty problems', async () => {
    const { results } = await dryRunAll({ rows: [row(2, { sku: 'OLD' }), row(3, { name: '' })], post: fakeServer(null), priceTaxMode: 'inclusive' })
    expect(tabCounts(results)).toMatchObject({ skipped: 1, errors: 1 })
    expect(problemText(results[0])).toBe('SKU موجود بالفعل — لن يتغير.')
  })
})

describe('importChunks', () => {
  const chunks = [[row(2), row(3)], [row(4), row(5)], [row(6)]]
  it('imports every chunk and tallies', async () => {
    const progress = vi.fn()
    const out = await importChunks({ chunks, total: 5, post: fakeServer(null), priceTaxMode: 'inclusive', onProgress: progress })
    expect(out.tally).toMatchObject({ created: 5, skipped: 0, failed: 0 })
    expect(out.pending).toEqual([])
    expect(progress).toHaveBeenLastCalledWith(5, 5, expect.objectContaining({ created: 5 }))
  })
  it('stops between chunks on request and keeps the rest', async () => {
    let calls = 0
    const out = await importChunks({ chunks, total: 5, post: fakeServer(null), priceTaxMode: 'inclusive', shouldStop: () => calls++ >= 1 })
    expect(out.stopped).toBe(true)
    expect(out.tally.created).toBe(2)
    expect(out.pending).toHaveLength(2)
  })
  it('a failed chunk leaves it and the rest pending, and resuming finishes without redoing work', async () => {
    const ok = fakeServer(null)
    let fail = true
    const flaky: Poster = async req => { if (req.rows[0].row_ref === 4 && fail) throw new Error('انقطع'); return ok(req) }
    const first = await importChunks({ chunks, total: 5, post: flaky, priceTaxMode: 'inclusive' })
    expect(first.error).toEqual({ chunk: 2, message: 'انقطع' })
    expect(first.tally.created).toBe(2)
    fail = false
    const second = await importChunks({ chunks: first.pending, total: 5, post: flaky, priceTaxMode: 'inclusive', results: first.results, tally: first.tally, startAt: 2 })
    expect(second.error).toBeUndefined()
    expect(second.tally.created).toBe(5)
    expect(second.results.size).toBe(5)
  })
})
