/**
 * The fixed list of reasons a stock adjustment line may carry. A code is stored
 * as text, so adding a reason later needs no migration. `other` needs a note.
 * `count_variance` is written only by stock counts and cannot be chosen here.
 */
export const ADJUSTMENT_REASONS = [
  { code: 'damaged', label_ar: 'تالف', label_en: 'Damaged' },
  { code: 'lost_stolen', label_ar: 'مفقود أو سرقة', label_en: 'Lost or stolen' },
  { code: 'expired', label_ar: 'انتهت صلاحيته', label_en: 'Expired' },
  { code: 'correction', label_ar: 'خطأ في تسجيل الرصيد', label_en: 'Recording error' },
  { code: 'internal_use', label_ar: 'استخدام داخلي أو عينة', label_en: 'Internal use or sample' },
  { code: 'gift', label_ar: 'هدية', label_en: 'Gift' },
  { code: 'other', label_ar: 'أخرى (اكتب ملاحظة)', label_en: 'Other (note required)' },
] as const;

export type AdjustmentReasonCode = (typeof ADJUSTMENT_REASONS)[number]['code'];

export const ADJUSTMENT_REASON_CODES: readonly string[] = ADJUSTMENT_REASONS.map((reason) => reason.code);

/** The reason that cannot be picked by hand: stock counts write it. */
export const COUNT_VARIANCE_REASON = 'count_variance';
