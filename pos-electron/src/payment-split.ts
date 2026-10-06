import { toCents } from '../electron/money'
import type { PaymentMethod } from '../electron/payment-methods'
import type { SalePayment } from '../electron/sale-payments'

/**
 * The payment screen's arithmetic. A row is one tender; its `amount` is what
 * stays in the till; left empty on the FIRST row (the main tender) it means "the rest". Cash rows
 * also have `received` (what the customer handed over): the difference is the
 * change. Everything is in piastres (integers); pure, no UI.
 */
export interface SplitRow {
  method: PaymentMethod
  amount: string
  /** Cash only; empty = exactly the amount. */
  received: string
}

export interface SplitState {
  /** Piastres applied per row (the first row's "rest" included). */
  applied: number[]
  /** Total minus everything applied: 0 when the payments cover the invoice, negative when they exceed it. */
  remaining: number
  change: number
  /** Why the sale cannot be confirmed yet (Arabic, for the cashier); null when it can. */
  problem: string | null
  payments: SalePayment[]
}

function parseCents(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!normalized) return null
  try {
    return toCents(normalized)
  } catch {
    return Number.NaN
  }
}

export function resolveSplit(rows: readonly SplitRow[], totalCents: number, hasCustomer: boolean): SplitState {
  const explicit = rows.map((row, index) => (index === 0 && !row.amount.trim() ? null : parseCents(row.amount)))
  const explicitSum = explicit.reduce<number>((sum, value) => sum + (value !== null && Number.isFinite(value) ? value : 0), 0)
  const applied = explicit.map((value, index) => (value === null ? (index === 0 ? Math.max(0, totalCents - explicitSum) : 0) : value))
  const remaining = totalCents - applied.reduce((sum, value) => sum + value, 0)

  const receivedOf = (row: SplitRow, index: number) => {
    const text = parseCents(row.received)
    return text === null ? applied[index]! : text
  }
  const change = rows.reduce((sum, row, index) => {
    if (row.method !== 'cash') return sum
    const received = receivedOf(row, index)
    return Number.isFinite(received) && received > applied[index]! ? sum + received - applied[index]! : sum
  }, 0)

  let problem: string | null = null
  if (!rows.length) problem = 'أضف طريقة دفع.'
  else if (applied.some((value) => !Number.isFinite(value) || value <= 0)) problem = 'أدخل مبلغًا صحيحًا لكل طريقة دفع.'
  else if (rows.some((row, index) => row.method === 'cash' && !(receivedOf(row, index) >= applied[index]!))) problem = 'المبلغ المستلم أقل من المبلغ المدفوع نقدًا.'
  else if (remaining > 0) problem = 'المبلغ المدفوع أقل من إجمالي الفاتورة.'
  else if (remaining < 0) problem = 'المبلغ المدفوع أكبر من إجمالي الفاتورة.'
  else if (rows.some((row) => row.method === 'credit') && !hasCustomer) problem = 'البيع الآجل يتطلب اختيار عميل.'

  const payments: SalePayment[] = problem
    ? []
    : rows.map((row, index) => {
        const received = receivedOf(row, index)
        const payment: SalePayment = { method: row.method, amount: applied[index]! / 100 }
        if (row.method === 'cash' && received > applied[index]!) payment.tendered = received / 100
        return payment
      })
  return { applied, remaining, change, problem, payments }
}

/** The rows after adding a method: it starts empty and its typed amount comes off the first row's "rest". */
export function addRow(rows: readonly SplitRow[], method: PaymentMethod): SplitRow[] {
  return [...rows, { method, amount: '', received: '' }]
}

/** The rows after removing one: when the first goes, the next becomes the main tender (takes the rest). */
export function removeRow(rows: readonly SplitRow[], index: number): SplitRow[] {
  const next = rows.filter((_, position) => position !== index)
  return index === 0 && next.length ? [{ ...next[0]!, amount: '' }, ...next.slice(1)] : next
}
