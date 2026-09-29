import { decimalToMinorUnits } from '../money-codec'
import { get, run, setMeta, tx } from './queries'

export interface LocalSaleItem {
  variant_id: string
  qty: number
}

export interface LocalSaleRecord {
  syncId: string
  invoiceNumber: string
  localTotal: number
  occurredAt: string
  paymentMethod: string
  customerPhone: string | null
  cashierId: string
  sellerId: string
  shiftId: string
  offlineSessionId: string
  terminalSequence: string
  items: LocalSaleItem[]
  /** Serialized sale command queued for upload. */
  outboxPayload: string
}

/**
 * The stock decrement, the sale row, the outbox command and the sequence
 * counter commit together or not at all.
 */
export function commitLocalSale(sale: LocalSaleRecord) {
  tx(() => {
    for (const item of sale.items) {
      const changed = run(
        `UPDATE stock SET qty=qty-? WHERE variant_id=? AND qty>=?`,
        [item.qty, item.variant_id, item.qty],
      )
      if (changed !== 1) {
        throw new Error(`Insufficient local stock for ${item.variant_id}`)
      }
    }
    run(
      `INSERT INTO sales_local (
        sync_id,invoice_number,total,created_at,occurred_at,payment_method,
        customer_phone,cashier_id,seller_id,shift_id,offline_session_id,terminal_sequence,
        total_minor_units
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        sale.syncId,
        sale.invoiceNumber,
        sale.localTotal,
        sale.occurredAt,
        sale.occurredAt,
        sale.paymentMethod,
        sale.customerPhone,
        sale.cashierId,
        sale.sellerId,
        sale.shiftId,
        sale.offlineSessionId,
        sale.terminalSequence,
        decimalToMinorUnits(sale.localTotal),
      ],
    )
    run(
      `INSERT INTO outbox (
        id,type,payload,sync_status,created_at,terminal_sequence,updated_at
      ) VALUES (?,?,?,?,?,?,?)`,
      [
        sale.syncId,
        'sale',
        sale.outboxPayload,
        'pending',
        sale.occurredAt,
        sale.terminalSequence,
        sale.occurredAt,
      ],
    )
    setMeta('terminal_sale_sequence', sale.terminalSequence)
  })
}

export function findSaleBySyncId(syncId: string) {
  return get(
    `SELECT sync_id,invoice_number,total,terminal_sequence,
            COALESCE(occurred_at,created_at) AS occurred_at
     FROM sales_local
     WHERE sync_id=?`,
    [syncId],
  )
}

export function highestStoredSaleSequence() {
  return String(
    get(
      `SELECT terminal_sequence
       FROM sales_local
       WHERE terminal_sequence IS NOT NULL
         AND terminal_sequence <> ''
       ORDER BY LENGTH(terminal_sequence) DESC, terminal_sequence DESC
       LIMIT 1`,
    )?.terminal_sequence || '0',
  )
}
