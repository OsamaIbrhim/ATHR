import { applyPlanLimit, DuplicateRegistry, planChunks, type RowStatus } from './chunking'
import type { ImportRow } from './rows'

export interface RowIssue { code: string; field?: string; message_ar?: string; message?: string }

export interface RowResult {
  row_ref: number
  sku: string
  name: string
  status: RowStatus
  errors: RowIssue[]
  warnings: RowIssue[]
}

export interface ImportRequest {
  dry_run: boolean
  on_existing_sku: 'skip'
  price_tax_mode: 'inclusive' | 'exclusive'
  branch_id?: string
  rows: ImportRow[]
}

export interface ChunkResponse {
  summary?: { categories_created?: number; opening_quantities?: number }
  plan_limit: { limit: number | null; current: number; remaining: number | null }
  rows: Array<{ row_ref: number | string | null; sku: string | null; status: RowStatus; errors: RowIssue[]; warnings: RowIssue[] }>
}

export type Poster = (request: ImportRequest) => Promise<ChunkResponse>

export interface RunOptions {
  rows: ImportRow[]
  post: Poster
  priceTaxMode: 'inclusive' | 'exclusive'
  branchId?: string
  onProgress?: (done: number, total: number, tally: Tally) => void
}

export interface Tally { created: number; skipped: number; failed: number; openingQuantities: number; categoriesCreated: number }

const nameOf = (row: ImportRow) => row.name ?? ''
const blank = (row: ImportRow): RowResult => ({ row_ref: row.row_ref, sku: row.sku ?? '', name: nameOf(row), status: 'failed', errors: [], warnings: [] })

/** Rows the client rejects itself because the same SKU/barcode appeared earlier (in this or an earlier file). */
export function precheckDuplicates(rows: ImportRow[], registry: DuplicateRegistry, label: string): { send: ImportRow[]; rejected: RowResult[] } {
  const send: ImportRow[] = []
  const rejected: RowResult[] = []
  for (const row of rows) {
    const issue = registry.check(row, `${label}الصف ${row.row_ref}`)
    if (issue) rejected.push({ ...blank(row), errors: [{ code: issue.code, message_ar: issue.message_ar }] })
    else send.push(row)
  }
  return { send, rejected }
}

/**
 * Dry run of every row, chunk by chunk. The server only sees one chunk at a time,
 * so the plan limit is applied across chunks here, from the first answer's
 * `plan_limit.remaining`, in file order.
 */
export async function dryRunAll(opts: RunOptions & { rejected?: RowResult[] }): Promise<{ results: RowResult[]; planLimit: ChunkResponse['plan_limit'] | null }> {
  const byRef = new Map<number, RowResult>()
  for (const r of opts.rejected ?? []) byRef.set(r.row_ref, r)
  let planLimit: ChunkResponse['plan_limit'] | null = null
  const chunks = planChunks(opts.rows)
  let done = 0
  for (const chunk of chunks) {
    const response = await opts.post({ dry_run: true, on_existing_sku: 'skip', price_tax_mode: opts.priceTaxMode, ...(opts.branchId ? { branch_id: opts.branchId } : {}), rows: chunk })
    planLimit ??= response.plan_limit
    const refs = new Map(chunk.map(r => [r.row_ref, r]))
    for (const row of response.rows) {
      const source = refs.get(Number(row.row_ref))
      if (!source) continue
      const limited = row.errors.some(e => e.code === 'ENTITLEMENT_LIMIT_REACHED')
      byRef.set(source.row_ref, { ...blank(source), sku: row.sku ?? source.sku ?? '', status: limited ? 'out_of_plan' : row.status, errors: row.errors, warnings: row.warnings })
    }
    done += chunk.length
    opts.onProgress?.(done, opts.rows.length, { created: 0, skipped: 0, failed: 0, openingQuantities: 0, categoriesCreated: 0 })
  }
  const ordered = [...byRef.values()].sort((a, b) => a.row_ref - b.row_ref)
  const remaining = planLimit?.remaining ?? null
  return { results: applyPlanLimit(ordered, remaining), planLimit }
}

export interface ImportOutcome {
  results: Map<number, RowResult>
  tally: Tally
  /** Chunks still to send after a failure or a stop. */
  pending: ImportRow[][]
  error?: { chunk: number; message: string }
  stopped: boolean
}

/** Sends the ready rows chunk by chunk. A failed chunk leaves the rest in `pending`; resending is safe (skipped by SKU). */
export async function importChunks(opts: Omit<RunOptions, 'rows'> & { chunks: ImportRow[][]; total: number; shouldStop?: () => boolean; results?: Map<number, RowResult>; tally?: Tally; startAt?: number }): Promise<ImportOutcome> {
  const results = opts.results ?? new Map<number, RowResult>()
  const tally: Tally = opts.tally ?? { created: 0, skipped: 0, failed: 0, openingQuantities: 0, categoriesCreated: 0 }
  let done = opts.startAt ?? 0
  for (let i = 0; i < opts.chunks.length; i++) {
    if (opts.shouldStop?.()) return { results, tally, pending: opts.chunks.slice(i), stopped: true }
    const chunk = opts.chunks[i]
    let response: ChunkResponse
    try {
      response = await opts.post({ dry_run: false, on_existing_sku: 'skip', price_tax_mode: opts.priceTaxMode, ...(opts.branchId ? { branch_id: opts.branchId } : {}), rows: chunk })
    } catch (e) {
      return { results, tally, pending: opts.chunks.slice(i), error: { chunk: i + 1, message: (e as Error).message }, stopped: false }
    }
    const refs = new Map(chunk.map(r => [r.row_ref, r]))
    for (const row of response.rows) {
      const source = refs.get(Number(row.row_ref))
      if (!source) continue
      results.set(source.row_ref, { ...blank(source), sku: row.sku ?? source.sku ?? '', status: row.status, errors: row.errors, warnings: row.warnings })
      if (row.status === 'created') tally.created += 1
      else if (row.status === 'skipped') tally.skipped += 1
      else tally.failed += 1
    }
    tally.openingQuantities += response.summary?.opening_quantities ?? 0
    tally.categoriesCreated += response.summary?.categories_created ?? 0
    done += chunk.length
    opts.onProgress?.(done, opts.total, { ...tally })
  }
  return { results, tally, pending: [], stopped: false }
}

/** Count of results per tab of the check step. */
export function tabCounts(results: RowResult[]) {
  const errors = results.filter(r => r.status === 'failed').length
  return {
    all: results.length,
    errors,
    warnings: results.filter(r => r.status === 'ready' && r.warnings.length > 0).length,
    skipped: results.filter(r => r.status === 'skipped').length,
    outOfPlan: results.filter(r => r.status === 'out_of_plan').length,
    ready: results.filter(r => r.status === 'ready').length,
  }
}

/** The sentence shown in the problem column. */
export function problemText(r: RowResult): string {
  if (r.status === 'out_of_plan') return 'تجاوز حد الباقة.'
  const first = r.errors[0] ?? r.warnings[0]
  return first?.message_ar || first?.message || ''
}
