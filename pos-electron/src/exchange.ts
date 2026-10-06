import type { RefundMethod } from '../electron/payment-methods'
import type { Customer } from './types'

/** The return half of an exchange, handed from the invoice screen to the register (which sells the new goods). */
export interface ExchangeStart {
  original_invoice_id: string
  invoice_number: string
  items: Array<{ sales_invoice_item_id: string; qty: number }>
  reason?: string
  refund_method: RefundMethod
  /** What the customer gets back (tax included), for the banner and the receipt of the exchange. */
  refund_total: number
  customer: Customer | null
}
