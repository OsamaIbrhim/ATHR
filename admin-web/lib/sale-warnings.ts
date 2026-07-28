export const SALE_WARNING_LABELS: Record<string, string> = {
  PRICE_VARIANCE: 'السعر وقت البيع يختلف عن السعر الحالي',
  NEGATIVE_STOCK: 'المخزون المركزي أصبح سالبًا',
  SEQUENCE_GAP: 'يوجد فراغ في ترتيب عمليات الجهاز',
  OUT_OF_ORDER_SEQUENCE: 'وصلت العملية بترتيب متأخر',
  LATE_SYNC: 'وصلت العملية بعد إغلاق الوردية',
  CASHIER_REFERENCE_MISSING: 'بيانات الكاشير الأصلية لم تعد موجودة',
  SELLER_REFERENCE_MISSING: 'بيانات البائع الأصلية لم تعد موجودة',
  SHIFT_REFERENCE_MISSING: 'بيانات الوردية الأصلية لم تعد موجودة',
}

export function saleWarningLabel(code: string) {
  return SALE_WARNING_LABELS[code] || code
}

export function saleWarningCodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((code): code is string => typeof code === 'string')
    : []
}
