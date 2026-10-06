import { ipcMain } from 'electron'
import { commitLocalSale } from '../db/sales'
import { q, setMeta } from '../db/queries'
import { minorUnitsToDecimal } from '../money-codec'
import { prepareSale } from './sale-prepare'

function listLocalSales() {
  return q(
    `SELECT
       s.sync_id,
       s.invoice_number AS local_invoice_number,
       COALESCE(s.server_invoice_number,s.invoice_number) AS invoice_number,
       s.server_invoice_id,
       s.server_invoice_number,
       s.synced_at,
       s.total_minor_units,
       s.created_at,
       COALESCE(s.occurred_at,s.created_at) AS occurred_at,
       s.payment_method,
       s.payments_json,
       s.discount_minor_units,
       s.customer_phone,
       s.cashier_id,
       s.seller_id,
       s.shift_id,
       s.offline_session_id,
       s.terminal_sequence,
       COALESCE(o.sync_status,'sent') AS sync_status,
       COALESCE(o.attempt_count,0) AS attempt_count,
       o.last_attempt_at,
       o.last_error,
       COALESCE(o.warning_codes,s.warning_codes,'[]') AS warning_codes,
       COALESCE(s.sync_result,o.sync_status,'sent') AS sync_result,
       s.voided_at,
       s.void_reason
     FROM sales_local s
     LEFT JOIN outbox o ON o.id=s.sync_id
     ORDER BY COALESCE(s.occurred_at,s.created_at) DESC
     LIMIT 100`,
  ).map((row) => {
    const { total_minor_units, ...rest } = row
    return { ...rest, total: Number(minorUnitsToDecimal(Number(total_minor_units ?? 0))) }
  })
}

function recordSale(sale: any) {
  const prepared = prepareSale(sale, { checkReplay: true })
  if ('replayed' in prepared) return { ...prepared.replayed, ok: true, replayed: true }
  const { validated, priced, command } = prepared

  commitLocalSale({
    syncId: validated.syncId,
    invoiceNumber: prepared.invoiceNumber,
    localTotal: validated.localTotal,
    occurredAt: prepared.occurredAt,
    payments: validated.payments,
    discountTotal: priced.discount,
    customerPhone: validated.customerPhone || null,
    cashierId: prepared.cashierId,
    sellerId: validated.sellerId,
    shiftId: prepared.shiftId,
    offlineSessionId: prepared.offlineSessionId,
    terminalSequence: prepared.terminalSequence,
    items: validated.items,
    outboxPayload: JSON.stringify(command),
  })
  return {
    sync_id: validated.syncId,
    invoice_number: prepared.invoiceNumber,
    terminal_sequence: prepared.terminalSequence,
    occurred_at: prepared.occurredAt,
    ok: true,
  }
}

/**
 * The sale half of an online exchange: validated, priced and numbered like any
 * sale, but sent by the register to `POST /pos/exchange` instead of the outbox.
 * The number and sequence are taken now and kept (a retry sends the same
 * command and the server replays it), so a later offline sale never reuses them.
 */
function prepareExchangeSale(sale: any) {
  const prepared = prepareSale(sale, { checkReplay: false })
  if ('replayed' in prepared) throw new Error('unreachable')
  setMeta('terminal_sale_sequence', prepared.terminalSequence)
  return {
    command: prepared.command,
    invoice_number: prepared.invoiceNumber,
    terminal_sequence: prepared.terminalSequence,
    occurred_at: prepared.occurredAt,
    total: prepared.priced.total,
  }
}

export function registerSalesIpc() {
  ipcMain.handle('pos:sale', (_event, sale: any) => recordSale(sale))
  ipcMain.handle('pos:prepare_exchange_sale', (_event, sale: any) => prepareExchangeSale(sale))
  ipcMain.handle('pos:list_local_sales', () => listLocalSales())
}
