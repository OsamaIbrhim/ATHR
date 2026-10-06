import { assertQuantityPrecision, findSaleBySyncId } from '../db/sales'
import { posSettings } from '../db/tenant-settings'
import { get, getMeta } from '../db/queries'
import { assertFactoryResetIdle } from '../factory-reset-runtime'
import { invoiceNumberFor } from '../invoice-number'
import { toCents } from '../money'
import { nextTerminalSequence, offlineAccountingContextMatches } from '../offline-accounting'
import { buildSaleCommand, priceAndCheckSale, type ValidatedSale } from '../sale-command'
import type { PricedCart } from '../sale-math'
import { assertPayments } from '../sale-payments'
import { validateLocalSaleInput } from '../sale-validation'
import { readSecureState } from '../secure-state'

export interface PreparedSale {
  validated: ValidatedSale
  priced: PricedCart
  command: ReturnType<typeof buildSaleCommand>
  invoiceNumber: string
  terminalSequence: string
  occurredAt: string
  cashierId: string
  shiftId: string
  offlineSessionId: string
}

/**
 * Everything a sale needs before it is stored or sent: the register's input
 * validated and priced with the shared arithmetic, the payments checked, the
 * next sequence number and the printed invoice number allocated, and the sale
 * command built. Stores nothing. `replayed` is set when this sync_id was
 * already saved (the register retried after a lost answer).
 */
export function prepareSale(sale: any, options: { checkReplay: boolean }): { replayed: ReturnType<typeof findSaleBySyncId> } | PreparedSale {
  assertFactoryResetIdle()
  const secure = readSecureState()
  const authSession = secure.auth?.session
  const context = secure.accounting
  const device = secure.device
  if (!device) throw new Error('This POS terminal is not enrolled')

  const validated = validateLocalSaleInput(sale, device.branch_id)
  const seller = get(`SELECT id,name FROM sellers WHERE id=?`, [validated.sellerId])
  if (!seller) {
    throw new Error('البائع المحدد غير موجود في قائمة الفرع المحلية. نفّذ مزامنة واختر البائع مرة أخرى.')
  }
  if (options.checkReplay) {
    const existing = findSaleBySyncId(validated.syncId)
    if (existing) return { replayed: existing }
  }
  assertQuantityPrecision(validated.items)

  const shift = context ? { id: context.shift_id, branch_id: context.branch_id } : null
  if (
    !authSession?.user ||
    !shift ||
    !offlineAccountingContextMatches(context, { session: { user: authSession.user as any }, device, shift })
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
  const terminalSequence = nextTerminalSequence(getMeta('terminal_sale_sequence'), context.server_last_sale_sequence)
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
  return {
    validated,
    priced,
    command,
    invoiceNumber,
    terminalSequence,
    occurredAt,
    cashierId: context.user_id,
    shiftId: context.shift_id,
    offlineSessionId: context.session_id,
  }
}
