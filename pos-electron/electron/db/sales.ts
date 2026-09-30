import { decimalToMinorUnits, minorUnitsToDecimal } from '../money-codec'
import { isValidQuantity } from '../quantity'
import { PosSaleValidationError } from '../sale-validation'
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

/** The server rejects a quantity finer than the unit allows (422), so refuse it before the sale is committed. */
export function assertQuantityPrecision(items: LocalSaleItem[]) {
  for (const item of items) {
    const precision = Number(get(`SELECT uom_precision FROM products WHERE id=?`, [item.variant_id])?.uom_precision ?? 0)
    if (!isValidQuantity(item.qty, precision)) {
      throw new PosSaleValidationError(
        'QUANTITY_PRECISION_EXCEEDED',
        'الكمية تحتوي على كسور أكثر مما تسمح به وحدة قياس الصنف.',
      )
    }
  }
}

/**
 * The stock decrement, the sale row, the outbox command and the sequence
 * counter commit together or not at all.
 */
export function commitLocalSale(sale: LocalSaleRecord) {
  tx(() => {
    for (const item of sale.items) {
      const changed = run(
        // Rounded to the stored 3 decimals so decimal sales never drift on float noise.
        `UPDATE stock SET qty=ROUND(qty-?,3) WHERE variant_id=? AND ROUND(qty,3)>=?`,
        [item.qty, item.variant_id, item.qty],
      )
      if (changed !== 1) {
        throw new Error(`Insufficient local stock for ${item.variant_id}`)
      }
    }
    run(
      `INSERT INTO sales_local (
        sync_id,invoice_number,total_minor_units,created_at,occurred_at,payment_method,
        customer_phone,cashier_id,seller_id,shift_id,offline_session_id,terminal_sequence
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        sale.syncId,
        sale.invoiceNumber,
        decimalToMinorUnits(sale.localTotal),
        sale.occurredAt,
        sale.occurredAt,
        sale.paymentMethod,
        sale.customerPhone,
        sale.cashierId,
        sale.sellerId,
        sale.shiftId,
        sale.offlineSessionId,
        sale.terminalSequence,
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
  const row = get(
    `SELECT sync_id,invoice_number,total_minor_units,terminal_sequence,
            COALESCE(occurred_at,created_at) AS occurred_at
     FROM sales_local
     WHERE sync_id=?`,
    [syncId],
  )
  if (!row) return undefined
  const { total_minor_units, ...rest } = row
  return { ...rest, total: Number(minorUnitsToDecimal(Number(total_minor_units ?? 0))) }
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
