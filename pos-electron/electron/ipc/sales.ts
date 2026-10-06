import { ipcMain } from 'electron'
import { assertQuantityPrecision, commitLocalSale, findSaleBySyncId } from '../db/sales'
import { posSettings } from '../db/tenant-settings'
import { get, getMeta, q } from '../db/queries'
import { assertFactoryResetIdle } from '../factory-reset-runtime'
import { toCents } from '../money'
import { minorUnitsToDecimal } from '../money-codec'
import {
  nextTerminalSequence,
  offlineAccountingContextMatches,
} from '../offline-accounting'
import { invoiceNumberFor } from '../invoice-number'
import { buildSaleCommand, priceAndCheckSale } from '../sale-command'
import { assertPayments } from '../sale-payments'
import { validateLocalSaleInput } from '../sale-validation'
import { readSecureState } from '../secure-state'

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
  assertFactoryResetIdle()
  const secure = readSecureState()
  const authSession = secure.auth?.session
  const context = secure.accounting
  const device = secure.device
  if (!device) throw new Error('This POS terminal is not enrolled')

  const validated = validateLocalSaleInput(sale, device.branch_id)
  const { syncId, items, sellerId } = validated
  const seller = get(`SELECT id,name FROM sellers WHERE id=?`, [sellerId])
  if (!seller) {
    throw new Error(
      'البائع المحدد غير موجود في قائمة الفرع المحلية. نفّذ مزامنة واختر البائع مرة أخرى.',
    )
  }
  const existing = findSaleBySyncId(syncId)
  if (existing) return { ...existing, ok: true, replayed: true }
  assertQuantityPrecision(items)

  const shift = context ? { id: context.shift_id, branch_id: context.branch_id } : null
  if (
    !authSession?.user ||
    !shift ||
    !offlineAccountingContextMatches(context, {
      session: { user: authSession.user as any },
      device,
      shift,
    })
  ) {
    throw new Error(
      'Offline accounting authorization is missing, expired, or does not match the current cashier, terminal, and shift',
    )
  }

  const settings = posSettings()
  const priced = priceAndCheckSale(validated, {
    role: authSession.user.role,
    maxDiscountPercent: settings.sales.max_discount_percent,
  })
  assertPayments(validated.payments, {
    totalCents: toCents(priced.total),
    enabled: settings.sales.payment_methods,
    customerPhone: validated.customerPhone,
  })

  const occurredAt = new Date().toISOString()
  const terminalSequence = nextTerminalSequence(
    getMeta('terminal_sale_sequence'),
    context.server_last_sale_sequence,
  )
  const invoiceNumber = invoiceNumberFor(device.terminal_code, terminalSequence)
  const command = buildSaleCommand({
    sale: validated,
    payments: validated.payments,
    branchId: device.branch_id,
    shiftId: context.shift_id,
    cashierId: context.user_id,
    cashierName: String(authSession.user.name || '').trim(),
    sellerName: String(seller.name || '').trim(),
    offlineSessionId: context.session_id,
    terminalSequence,
    invoiceNumber,
    occurredAt,
  })

  commitLocalSale({
    syncId,
    invoiceNumber,
    localTotal: validated.localTotal,
    occurredAt,
    payments: validated.payments,
    discountTotal: priced.discount,
    customerPhone: validated.customerPhone || null,
    cashierId: context.user_id,
    sellerId,
    shiftId: context.shift_id,
    offlineSessionId: context.session_id,
    terminalSequence,
    items,
    outboxPayload: JSON.stringify(command),
  })
  return {
    sync_id: syncId,
    invoice_number: invoiceNumber,
    terminal_sequence: terminalSequence,
    occurred_at: occurredAt,
    ok: true,
  }
}

export function registerSalesIpc() {
  ipcMain.handle('pos:sale', (_event, sale: any) => recordSale(sale))
  ipcMain.handle('pos:list_local_sales', () => listLocalSales())
}
