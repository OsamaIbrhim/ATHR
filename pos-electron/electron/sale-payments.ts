import { toCents } from './money'
import { isPaymentMethod, type PaymentMethod } from './payment-methods'
import { PosSaleValidationError } from './sale-error'

/** One tender of a sale. `amount` stays in the till (cash: net of change); `tendered` is for the receipt only. */
export interface SalePayment {
  method: PaymentMethod
  amount: number
  tendered?: number
  reference?: string
}

const MAX_PAYMENTS = 10
const invalid = (message: string) => new PosSaleValidationError('PAYMENTS_INVALID', message)

function centsOf(value: unknown): number {
  try {
    return toCents(value as number)
  } catch {
    return Number.NaN
  }
}

/** Reads `payments[]` from the register: shape only (the amounts are checked against the total by {@link assertPayments}). */
export function parsePayments(raw: unknown): SalePayment[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PAYMENTS) {
    throw invalid('أدخل طريقة دفع واحدة على الأقل (حتى 10).')
  }
  return raw.map((entry: any) => {
    const amountCents = centsOf(entry?.amount)
    if (!isPaymentMethod(entry?.method) || !Number.isFinite(amountCents) || amountCents <= 0) {
      throw invalid('طريقة دفع أو مبلغ غير صحيح.')
    }
    const payment: SalePayment = { method: entry.method, amount: amountCents / 100 }
    if (entry.tendered !== undefined && entry.tendered !== null) {
      const tenderedCents = centsOf(entry.tendered)
      if (entry.method !== 'cash' || !Number.isFinite(tenderedCents) || tenderedCents < amountCents) {
        throw invalid('المبلغ المستلم يجب أن يكون نقدًا وأكبر من أو يساوي المبلغ المدفوع.')
      }
      payment.tendered = tenderedCents / 100
    }
    if (typeof entry.reference === 'string' && entry.reference.trim()) payment.reference = entry.reference.trim().slice(0, 100)
    return payment
  })
}

/**
 * The payments must add up to the invoice total to the piastre, use only the
 * methods the tenant switched on, and put credit on a customer who exists.
 */
export function assertPayments(
  payments: readonly SalePayment[],
  options: { totalCents: number; enabled: readonly PaymentMethod[]; customerPhone?: string },
) {
  const paid = payments.reduce((sum, payment) => sum + toCents(payment.amount), 0)
  if (paid !== options.totalCents) {
    throw new PosSaleValidationError('PAYMENT_TOTAL_MISMATCH', 'مجموع المدفوعات لا يساوي إجمالي الفاتورة.')
  }
  const disabled = payments.find((payment) => !options.enabled.includes(payment.method))
  if (disabled) {
    throw new PosSaleValidationError('PAYMENT_METHOD_DISABLED', 'طريقة الدفع غير مفعّلة في إعدادات المتجر.')
  }
  if (payments.some((payment) => payment.method === 'credit') && !options.customerPhone) {
    throw new PosSaleValidationError('CREDIT_NEEDS_CUSTOMER', 'البيع الآجل يتطلب اختيار عميل.')
  }
}

/** One value for the list views: the single method, or `split` for several. */
export function paymentSummary(payments: readonly SalePayment[]): string {
  const methods = [...new Set(payments.map((payment) => payment.method))]
  return methods.length === 1 ? methods[0]! : 'split'
}
