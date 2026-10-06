import type { PickedItem } from './items'
import { decimalsOf, numberOf } from './number-input'

export const MAX_OPENING_LINES = 500

export interface OpeningLine {
  item: PickedItem
  qty: string
  cost: string
  /** The cost was prefilled from the item's own cost. */
  costFromItem: boolean
  precision: number
  /** Pack multiplier of the last scan ("×6"). */
  packQty: number
  /** The server's reason for rejecting this line. */
  serverError?: string
}

export type LineErrors = { qty?: string; cost?: string; warn?: string }

/** Client-side check of one line; an empty object means it can be sent. */
export function validateOpeningLine(line: OpeningLine, opts: { needCost: boolean }): LineErrors {
  const errors: LineErrors = {}
  const qty = numberOf(line.qty)
  if (qty === null || qty <= 0) errors.qty = 'اكتب الكمية'
  else if (decimalsOf(line.qty) > line.precision) {
    errors.qty = line.precision === 0 ? 'هذا الصنف يُباع بالقطعة؛ اكتب عددًا صحيحًا.' : `بحد أقصى ${line.precision} أرقام بعد الفاصلة.`
  }
  if (opts.needCost) {
    const cost = numberOf(line.cost)
    if (cost === null) errors.cost = 'اكتب التكلفة'
    else if (cost === 0) errors.warn = 'التكلفة صفر — ستظهر الأرباح غير صحيحة.'
  }
  return errors
}

export const lineValue = (line: Pick<OpeningLine, 'qty' | 'cost'>): number => (numberOf(line.qty) ?? 0) * (numberOf(line.cost) ?? 0)

export function totals(lines: OpeningLine[]): { items: number; value: number } {
  return { items: lines.length, value: lines.reduce((sum, line) => sum + lineValue(line), 0) }
}

/** The request body; cost is omitted when the user has no cost permission (the server then uses the item's cost). */
export function buildOpeningBody(branchId: string, key: string, lines: OpeningLine[], withCost: boolean) {
  return {
    branch_id: branchId,
    idempotency_key: key,
    lines: lines.map(line => ({
      variant_id: line.item.id,
      qty: Number(line.qty),
      ...(withCost ? { unit_cost: Number(line.cost) } : {}),
    })),
  }
}

export interface OpeningResultRow { index: number; variant_id: string; status: 'posted' | 'rejected'; message_ar?: string; message?: string }

/** After a response: posted lines leave, rejected ones stay with the server's reason. */
export function applyOpeningResults(lines: OpeningLine[], results: OpeningResultRow[]): { remaining: OpeningLine[]; posted: number; rejected: number } {
  const byVariant = new Map(results.map(r => [r.variant_id, r]))
  const remaining: OpeningLine[] = []
  let posted = 0
  for (const line of lines) {
    const result = byVariant.get(line.item.id)
    if (result?.status === 'posted') { posted += 1; continue }
    remaining.push({ ...line, serverError: result ? result.message_ar || result.message || 'رُفض هذا السطر.' : line.serverError })
    continue
  }
  return { remaining, posted, rejected: remaining.filter(l => l.serverError).length }
}

/** A stable key for one payload: the same lines retry with the same key, edited lines get a new one. */
export function payloadSignature(body: { branch_id: string; lines: unknown[] }): string {
  return JSON.stringify([body.branch_id, body.lines])
}

export const draftKey = (branchId: string) => `athr.opening.draft.${branchId}`

export interface DraftLine { item: PickedItem; qty: string; cost: string; costFromItem: boolean; precision: number; packQty: number }

export function saveDraft(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, branchId: string, lines: OpeningLine[]) {
  try {
    if (!storage) return
    if (!lines.length) storage.removeItem(draftKey(branchId))
    else storage.setItem(draftKey(branchId), JSON.stringify(lines.map(({ serverError: _e, ...rest }) => rest)))
  } catch { /* draft is a convenience */ }
}

export function loadDraft(storage: Pick<Storage, 'getItem'> | null, branchId: string): DraftLine[] {
  try {
    const parsed = JSON.parse(storage?.getItem(draftKey(branchId)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(l => l?.item?.id) : []
  } catch { return [] }
}
