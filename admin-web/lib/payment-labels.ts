const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  wallet: 'محفظة',
  bank_transfer: 'تحويل',
  credit: 'آجل',
  other: 'أخرى',
}

export function paymentLabel(method: string) {
  return PAYMENT_LABELS[method] ?? method
}

export function paymentsSummary(payments?: { method: string; amount: string | number }[]) {
  if (!payments?.length) return '—'
  if (payments.length === 1) return paymentLabel(payments[0].method)
  return payments.map((p) => `${paymentLabel(p.method)} ${Number(p.amount).toFixed(2)}`).join(' + ')
}
