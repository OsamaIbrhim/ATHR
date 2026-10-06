import type { Tone } from '@/components/ui/StatusBadge'
import type { ScanResult } from './count-queue'

export type CountStatus = 'open' | 'posted' | 'cancelled'
export const COUNT_STATUS_LABEL: Record<CountStatus, string> = { open: 'جارٍ العدّ', posted: 'مرحّل', cancelled: 'ملغي' }
export const COUNT_STATUS_TONE: Record<CountStatus, Tone> = { open: 'info', posted: 'ok', cancelled: 'neutral' }

export interface ScopeInfo { type: 'all' | 'category' | 'product_type'; id?: string | null; name?: string | null }

export function scopeLabel(scope: ScopeInfo | null | undefined): string {
  if (!scope || scope.type === 'all') return 'كل الأصناف'
  return `${scope.type === 'category' ? 'تصنيف' : 'نوع'}: ${scope.name ?? '—'}`
}

export function defaultCountName(branchName: string, date: string): string {
  return `جرد ${branchName} ${date}`.trim()
}

export interface VariantLite { id: string; sku: string; label: string | null; name_ar: string | null; name_en: string | null }
export const variantName = (v: Pick<VariantLite, 'name_ar' | 'name_en' | 'sku'>) => v.name_ar || v.name_en || v.sku

export interface MineRow { variant: VariantLite; mine: number; total: number; lastAt: number }

export type LastCard =
  | { kind: 'counted'; variant: VariantLite; mine: number; total: number; packQty: number; added: number; at: number }
  | { kind: 'unknown'; code: string }
  | { kind: 'out_of_scope'; variant: VariantLite | null; code: string; entryId: string }
  | { kind: 'problem'; message: string }

export interface CounterState { mine: Map<string, MineRow>; last: LastCard | null; unknownScans: number }

export const emptyCounterState = (): CounterState => ({ mine: new Map(), last: null, unknownScans: 0 })

/** Folds the server's answers into the counter: the server's totals are authoritative. */
export function applyResults(state: CounterState, results: ScanResult[], now: number): CounterState {
  const mine = new Map(state.mine)
  let last = state.last
  let unknownScans = state.unknownScans
  for (const r of results as any[]) {
    if (r.status === 'duplicate') continue
    const variant: VariantLite | null = r.variant ?? null
    if (r.status === 'counted' && variant) {
      const total = Number(r.counted_total)
      const myTotal = Number(r.counted_by_me)
      if (myTotal === 0) mine.delete(variant.id)
      else mine.set(variant.id, { variant, mine: myTotal, total, lastAt: now })
      last = { kind: 'counted', variant, mine: myTotal, total, packQty: Number(r.pack_qty) || 1, added: Number(r.added) || 0, at: now }
    } else if (r.status === 'unknown_barcode') {
      unknownScans += 1
      last = { kind: 'unknown', code: String(r.barcode ?? '') }
    } else if (r.status === 'out_of_scope') {
      last = { kind: 'out_of_scope', variant, code: String(r.barcode ?? ''), entryId: r.entry_id }
    } else {
      last = { kind: 'problem', message: r.message_ar || MESSAGES[r.status] || 'تعذر عدّ هذا الصنف.' }
    }
  }
  return { mine, last, unknownScans }
}

const MESSAGES: Record<string, string> = {
  tracked_not_supported: 'الأصناف المتتبَّعة لا تُجرد هنا حاليًا.',
  not_countable: 'هذا الصنف لا يُجرد.',
  precision_exceeded: 'الكمية بها كسور أكثر مما تسمح به الوحدة.',
  below_zero: 'لا يمكن أن يقل العدّ عن صفر.',
  invalid_quantity: 'كمية غير صالحة.',
  variant_not_found: 'الصنف غير موجود.',
  rejected: 'رُفض هذا المسح.',
}

/** Shows a +/-/set change immediately, before the server answers. The next result replaces it. */
export function bumpLocal(state: CounterState, variant: VariantLite, change: { add?: number; set?: number }, now: number): CounterState {
  const mine = new Map(state.mine)
  const before = mine.get(variant.id)
  const next = change.set !== undefined ? change.set : Math.max(0, (before?.mine ?? 0) + (change.add ?? 0))
  const total = Math.max(0, (before?.total ?? 0) + (next - (before?.mine ?? 0)))
  if (next === 0) mine.delete(variant.id); else mine.set(variant.id, { variant, mine: next, total, lastAt: now })
  return { ...state, mine, last: { kind: 'counted', variant, mine: next, total, packQty: 1, added: next - (before?.mine ?? 0), at: now } }
}

/** A scanner gun sends digits then Enter; those are counted without a search. */
export const isBarcodeLike = (text: string) => /^\d{6,}$/.test(text.trim())

export const UNDO_WINDOW_MS = 10_000

export type UncountedChoice = 'ignore' | 'zero'

/** Body of POST /:id/post. The choice is required only when uncounted items hold a balance. */
export function buildPostBody(choice: UncountedChoice | null, overrides: Set<string>) {
  if (!choice) return {}
  return choice === 'ignore'
    ? { uncounted: choice, ...(overrides.size ? { zero_variant_ids: [...overrides] } : {}) }
    : { uncounted: choice, ...(overrides.size ? { keep_variant_ids: [...overrides] } : {}) }
}

/** Why posting is blocked, or '' when it is allowed (spec 5.6 item 4). */
export function postBlockReason(opts: { canPost: boolean; countedItems: number; uncountedItems: number; choice: UncountedChoice | null }): string {
  if (!opts.canPost) return 'الترحيل يقوم به مسؤول المخزون.'
  if (opts.countedItems === 0) return 'لم يُعدّ أي صنف بعد.'
  if (opts.uncountedItems > 0 && !opts.choice) return 'اختر ما يحدث للأصناف التي لم تُعدّ أولًا.'
  return ''
}

export type ReviewFilter = 'variance' | 'all' | 'increase' | 'decrease' | 'uncounted' | 'unknown'
