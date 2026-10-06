/** How a sale can be paid; mirrors the backend's `sales/payment-methods.ts`. `credit` puts the amount on the customer's account. */
export const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'bank_transfer', 'credit', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** How a return can be refunded. `credit` reduces what the customer owes. */
export const REFUND_METHODS = ['cash', 'credit', 'card', 'wallet', 'other'] as const
export type RefundMethod = (typeof REFUND_METHODS)[number]

/** Methods a tenant accepts until it says otherwise. */
export const DEFAULT_PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'card', 'wallet', 'credit']

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  wallet: 'محفظة إلكترونية',
  bank_transfer: 'تحويل بنكي',
  credit: 'آجل (على حساب العميل)',
  other: 'أخرى',
}

/** Names of methods older tills stored (`payment_method`), kept so old rows still read well. */
const LEGACY_LABELS: Record<string, string> = {
  instapay: 'InstaPay',
  vodafone_cash: 'فودافون كاش',
  installment: 'تقسيط',
  split: 'مقسّم',
}

export const isPaymentMethod = (value: unknown): value is PaymentMethod =>
  typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)

export const isRefundMethod = (value: unknown): value is RefundMethod =>
  typeof value === 'string' && (REFUND_METHODS as readonly string[]).includes(value)

/** The Arabic name of any method the till or the server may mention (an unknown one is shown as it is). */
export function paymentLabel(method: string): string {
  return isPaymentMethod(method) ? PAYMENT_LABELS[method] : (LEGACY_LABELS[method] ?? method)
}
