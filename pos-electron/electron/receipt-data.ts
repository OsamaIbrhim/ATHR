import { fromCents, lineCents, toCents } from './money'
import { priceCart, type Discount, type PricedCartLine } from './sale-math'
import type { ReceiptData, ReceiptLine } from './receipt-html'
import type { SalePayment } from './sale-payments'

const cents = (value: number | string | null | undefined) => toCents(value ?? 0)
const pounds = (value: number) => fromCents(value)

export interface ReceiptCartLine extends PricedCartLine {
  name: string
  label?: string | null
  uom_name_ar?: string | null
}

/** The change given back: cash handed over minus the cash that stayed in the till (0 when no cash was over-tendered). */
export function changeOf(payments: readonly SalePayment[]): number {
  const cents = payments.reduce(
    (sum, payment) => (payment.method === 'cash' && payment.tendered !== undefined ? sum + toCents(payment.tendered) - toCents(payment.amount) : sum),
    0,
  )
  return pounds(Math.max(0, cents))
}

/** The receipt of a sale that has just been rung up on this till. */
export function receiptFromCart(input: {
  invoiceNumber: string
  occurredAt: string
  lines: readonly ReceiptCartLine[]
  invoiceDiscount?: Discount | null
  payments: readonly SalePayment[]
  customer?: string | null
}): ReceiptData {
  const priced = priceCart(input.lines, input.invoiceDiscount)
  const lines: ReceiptLine[] = input.lines.map((line, index) => {
    const result = priced.sale.lines[index]!
    return {
      name: line.name,
      label: line.label,
      qty: line.qty,
      uom_name_ar: line.uom_name_ar,
      unit_price: pounds(cents(line.unit_price) + cents(line.unit_tax)),
      // What the line cost before discounts, tax included (the discount is shown on its own).
      amount: pounds(cents(result.netBeforeDiscount) + cents(result.taxBeforeDiscount)),
    }
  })
  return {
    invoice_number: input.invoiceNumber,
    occurred_at: input.occurredAt,
    lines,
    subtotal: priced.subtotal,
    discount: priced.discount,
    tax: priced.tax,
    total: priced.total,
    payments: input.payments.map(({ method, amount, tendered }) => ({ method, amount, tendered })),
    change: changeOf(input.payments),
    customer: input.customer,
  }
}

/** A stored invoice as the server returns it (`GET /sales/:id`), for reprinting. */
export interface ServerInvoice {
  invoice_number: string
  occurred_at?: string
  created_at: string
  subtotal: number | string
  discount_amount?: number | string | null
  tax_amount: number | string
  total: number | string
  customer?: { name?: string | null; phone: string } | null
  items?: Array<{
    qty: number
    unit_price: number | string
    unit_tax: number | string
    name?: string
    label?: string | null
  }>
  payments?: Array<{ method: string; amount: number | string; tendered?: number | string | null }>
}

export function receiptFromInvoice(invoice: ServerInvoice): ReceiptData {
  const payments = (invoice.payments ?? []).map((payment) => ({
    method: payment.method,
    amount: Number(payment.amount),
    tendered: payment.tendered === null || payment.tendered === undefined ? undefined : Number(payment.tendered),
  }))
  return {
    invoice_number: invoice.invoice_number,
    occurred_at: invoice.occurred_at || invoice.created_at,
    lines: (invoice.items ?? []).map((item) => ({
      name: item.name ?? '',
      label: item.label,
      qty: Number(item.qty),
      unit_price: pounds(cents(item.unit_price) + cents(item.unit_tax)),
      amount: pounds(lineCents(item.unit_price, Number(item.qty)) + lineCents(item.unit_tax, Number(item.qty))),
    })),
    subtotal: Number(invoice.subtotal),
    discount: Number(invoice.discount_amount ?? 0),
    tax: Number(invoice.tax_amount),
    total: Number(invoice.total),
    payments,
    change: changeOf(payments.map((payment) => ({ ...payment, method: payment.method as SalePayment['method'] }))),
    customer: invoice.customer?.name || invoice.customer?.phone || null,
  }
}
