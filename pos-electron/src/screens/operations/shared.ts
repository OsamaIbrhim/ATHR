import { subtractQuantity, sumQuantities } from '../../../electron/quantity'
import { paymentLabel } from '../../../electron/payment-methods'
import type { Invoice, InvoiceItem } from '../../types'

export type ReturnableInvoiceItem = InvoiceItem & {
  returned_qty: number
  returnable_qty: number
  /** Whole-line discount (tax-exclusive) and tax, as the lookup returns them. */
  discount_amount?: number | string | null
  tax_amount?: number | string | null
}

export type ReturnableInvoice = Invoice & {
  items: ReturnableInvoiceItem[]
}

export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void

export function itemName(item: InvoiceItem) {
  const name =
    item.variant?.product?.name_ar ||
    item.variant?.product?.name_en ||
    item.variant?.sku ||
    item.variant_id
  const label = String(item.variant_label_snapshot || item.variant?.label || '').trim()
  return label ? `${name} — ${label}` : name
}

export function returnedQty(item: InvoiceItem) {
  return sumQuantities((item.return_items || []).map((record) => Number(record.qty || 0)))
}


/** "نقدي + بطاقة": the methods an invoice was paid with. */
export function paymentsLabel(invoice: Pick<Invoice, 'payments'>): string {
  const methods = [...new Set((invoice.payments ?? []).map((payment) => payment.method))]
  return methods.length ? methods.map(paymentLabel).join(' + ') : '—'
}

/** True when a local (till) sale took a payment with `method`; reads the stored payments, falls back to the summary column. */
export function localSalePaysWith(
  sale: { payment_method?: string; payments_json?: string | null },
  method: string,
): boolean {
  try {
    const payments = JSON.parse(sale.payments_json ?? '[]') as Array<{ method: string }>
    if (payments.length) return payments.some((payment) => payment.method === method)
  } catch {
    // fall through to the summary column
  }
  return sale.payment_method === method
}
