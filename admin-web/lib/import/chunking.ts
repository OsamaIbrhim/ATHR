import { barcodesOf, effectiveSku, type ImportRow } from './rows'

export const MAX_CHUNK_ROWS = 2000
export const MAX_CHUNK_BYTES = 1_500_000

const encoder = new TextEncoder()
export const rowBytes = (row: ImportRow) => encoder.encode(JSON.stringify(row)).length + 1

/** Splits rows into requests of at most `maxRows` rows and about `maxBytes` of JSON (the server limit is 2mb). */
export function planChunks(rows: ImportRow[], opts: { maxRows?: number; maxBytes?: number } = {}): ImportRow[][] {
  const maxRows = opts.maxRows ?? MAX_CHUNK_ROWS
  const maxBytes = opts.maxBytes ?? MAX_CHUNK_BYTES
  const chunks: ImportRow[][] = []
  let current: ImportRow[] = []
  let size = 0
  for (const row of rows) {
    const bytes = rowBytes(row)
    if (current.length && (current.length >= maxRows || size + bytes > maxBytes)) {
      chunks.push(current); current = []; size = 0
    }
    current.push(row); size += bytes
  }
  if (current.length) chunks.push(current)
  return chunks
}

export interface DuplicateIssue {
  code: 'IMPORT_DUPLICATE_SKU_IN_FILE' | 'IMPORT_DUPLICATE_BARCODE_IN_FILE'
  message_ar: string
}

/**
 * Remembers every SKU and barcode accepted so far (this file and earlier files
 * of the session). The server checks duplicates only inside one request, so the
 * admin catches the rest: the first occurrence wins, later ones are rejected.
 */
export class DuplicateRegistry {
  private skus = new Map<string, string>()
  private barcodes = new Map<string, string>()

  /** An independent copy, so a check that is later redone (another mapping) can start from the same state. */
  clone(): DuplicateRegistry {
    const copy = new DuplicateRegistry()
    copy.skus = new Map(this.skus)
    copy.barcodes = new Map(this.barcodes)
    return copy
  }

  /** Returns the issue for this row, or registers it and returns null. `where` labels the first occurrence ("الصف 12" or "الملف الأول، الصف 12"). */
  check(row: ImportRow, where: string): DuplicateIssue | null {
    const sku = effectiveSku(row)
    const codes = barcodesOf(row)
    if (sku && this.skus.has(sku)) {
      return { code: 'IMPORT_DUPLICATE_SKU_IN_FILE', message_ar: `SKU ${sku} مكرر في الملف (${this.skus.get(sku)}).` }
    }
    const clash = codes.find(code => this.barcodes.has(code))
    if (clash) {
      return { code: 'IMPORT_DUPLICATE_BARCODE_IN_FILE', message_ar: `الباركود ${clash} مكرر في الملف (${this.barcodes.get(clash)}).` }
    }
    if (sku) this.skus.set(sku, where)
    for (const code of codes) this.barcodes.set(code, where)
    return null
  }
}

export type RowStatus = 'ready' | 'created' | 'skipped' | 'failed' | 'out_of_plan'

/**
 * Applies the plan limit across chunks: each dry run only knows the products that
 * already exist, so the admin lets the first `remaining` ready rows (in file
 * order) through and marks the rest out of plan. `remaining` null = unlimited.
 */
export function applyPlanLimit<T extends { status: RowStatus }>(rows: T[], remaining: number | null): T[] {
  if (remaining === null) return rows
  let slots = Math.max(0, remaining)
  return rows.map(row => {
    if (row.status !== 'ready') return row
    if (slots > 0) { slots -= 1; return row }
    return { ...row, status: 'out_of_plan' as const }
  })
}
