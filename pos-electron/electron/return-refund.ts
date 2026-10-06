import { cumulativeShare, lineAmount } from '@athr/domain-core'
import { fromCents, toCents } from './money'

/** A sold line as `GET /pos/invoices/lookup` returns it. */
export interface SoldLine {
  qty: number | string
  unit_price: number | string
  unit_tax?: number | string | null
  /** Tax-exclusive discount of the whole line (own + share of the invoice discount). */
  discount_amount?: number | string | null
  /** Tax of the whole line, after the discount. */
  tax_amount?: number | string | null
}

export interface LineRefund {
  net: number
  tax: number
  gross: number
}

/**
 * What returning `returning` units of a line refunds: that share of what was
 * paid for it (net after discount, and tax). The same function the server uses
 * (`@athr/domain-core` `cumulativeShare`, cumulative over what was returned
 * before), so the till shows exactly what the server will refund.
 */
export function refundForLine(line: SoldLine, returnedBefore: number, returning: number): LineRefund {
  const qty = String(line.qty)
  const lineNet = fromCents(toCents(lineAmount(line.unit_price, qty)) - toCents(line.discount_amount ?? 0))
  const lineTax = line.tax_amount ?? lineAmount(line.unit_tax ?? 0, qty)
  const share = (amount: number | string) => Number(cumulativeShare(amount, qty, returnedBefore, returning))
  const net = share(lineNet)
  const tax = share(lineTax)
  return { net, tax, gross: fromCents(toCents(net) + toCents(tax)) }
}
