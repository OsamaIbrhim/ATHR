import type { Tone } from '@/components/ui/StatusBadge'
import type { PickedItem } from './items'
import { decimalsOf, numberOf } from './number-input'

export const MAX_ADJUSTMENT_LINES = 300

export const REASONS = [
  { code: 'damaged', label: 'تالف' },
  { code: 'lost_stolen', label: 'مفقود أو سرقة' },
  { code: 'expired', label: 'انتهت صلاحيته' },
  { code: 'correction', label: 'خطأ في تسجيل الرصيد' },
  { code: 'internal_use', label: 'استخدام داخلي أو عينة' },
  { code: 'gift', label: 'هدية' },
  { code: 'other', label: 'أخرى (اكتب ملاحظة)' },
] as const

/** `count_variance` is written by counts only; it is shown but never offered. */
export const reasonLabel = (code: string) => (code === 'count_variance' ? 'فرق جرد' : REASONS.find(r => r.code === code)?.label ?? code)

export type AdjustmentStatus = 'draft' | 'approved' | 'posted' | 'cancelled'

export const STATUS_LABEL: Record<AdjustmentStatus, string> = { draft: 'مسودة', approved: 'معتمدة', posted: 'مرحّلة', cancelled: 'ملغاة' }
export const STATUS_TONE: Record<AdjustmentStatus, Tone> = { draft: 'neutral', approved: 'info', posted: 'ok', cancelled: 'neutral' }

export interface AdjustmentLine {
  item: PickedItem
  /** Signed quantity as typed. */
  qty: string
  reason: string
  note: string
  precision: number
  /** On hand in the branch now. */
  onHand: number | null
  /** Unit cost when known (only with view-cost). */
  unitCost: number | null
  /** The reason is locked (count-generated or posted). */
  locked?: boolean
}

export type AdjustmentLineErrors = { qty?: string; reason?: string; note?: string }

export function validateAdjustmentLine(line: AdjustmentLine): AdjustmentLineErrors {
  const errors: AdjustmentLineErrors = {}
  const qty = numberOf(line.qty)
  if (qty === null || qty === 0) errors.qty = 'اكتب كمية أكبر أو أقل من صفر'
  else if (decimalsOf(line.qty) > line.precision) {
    errors.qty = line.precision === 0 ? 'هذا الصنف يُباع بالقطعة؛ اكتب عددًا صحيحًا.' : `بحد أقصى ${line.precision} أرقام بعد الفاصلة.`
  }
  if (!line.reason) errors.reason = 'اختر السبب'
  if (line.reason === 'other' && !line.note.trim()) errors.note = 'اكتب ملاحظة'
  return errors
}

export const deltaOf = (line: Pick<AdjustmentLine, 'qty'>) => numberOf(line.qty) ?? 0
export const afterOf = (line: AdjustmentLine): number | null => (line.onHand === null ? null : line.onHand + deltaOf(line))
export const valueOf = (line: AdjustmentLine): number | null => (line.unitCost === null ? null : deltaOf(line) * line.unitCost)

export function adjustmentTotals(lines: AdjustmentLine[]) {
  let increase = 0; let decrease = 0; let known = true; let negatives = 0
  for (const line of lines) {
    const value = valueOf(line)
    if (value === null) known = false
    else if (value >= 0) increase += value
    else decrease += -value
    const after = afterOf(line)
    if (after !== null && after < 0) negatives += 1
  }
  return { increase, decrease, net: increase - decrease, valueKnown: known && lines.length > 0, negatives }
}

export function buildAdjustmentBody(lines: AdjustmentLine[], note: string) {
  return {
    ...(note.trim() ? { note: note.trim() } : {}),
    lines: lines.map(l => ({
      variant_id: l.item.id,
      qty_delta: Number(l.qty),
      reason_code: l.reason,
      ...(l.note.trim() ? { note: l.note.trim() } : {}),
    })),
  }
}

/** Which action buttons a user sees for a document, per spec 4.2. */
export function documentActions(status: AdjustmentStatus, can: { request: boolean; approve: boolean; post: boolean }) {
  return {
    edit: status === 'draft' && can.request,
    approve: status === 'draft' && can.approve,
    post: status === 'approved' && can.post,
    cancel: (status === 'draft' || status === 'approved') && (can.request || can.approve),
    waitingApproval: status === 'draft' && !can.approve,
    waitingPost: status === 'approved' && !can.post,
  }
}

/** Progress of the three-step strip: 0 request, 1 approval, 2 post (3 = all done). */
export function progressStep(status: AdjustmentStatus): number {
  return status === 'draft' ? 1 : status === 'approved' ? 2 : status === 'posted' ? 3 : 0
}

/** The "below zero" line errors the server returns carry `data.line_index`; map it back to a message. */
export function lineErrorFrom(error: { data?: { line_index?: number }; message: string }): { index: number; message: string } | null {
  const index = error.data?.line_index
  return typeof index === 'number' ? { index, message: error.message } : null
}
