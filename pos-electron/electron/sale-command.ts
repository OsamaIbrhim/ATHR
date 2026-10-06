import { toCents } from './money'
import { PosSaleValidationError } from './sale-error'
import { discountLimitFor, exceedsDiscountLimit, hasAnyDiscount, lineWithoutTaxRate, priceCart, type PricedCart } from './sale-math'
import type { SalePayment } from './sale-payments'
import { saleItemCommand, type validateLocalSaleInput } from './sale-validation'

export type ValidatedSale = ReturnType<typeof validateLocalSaleInput>

/**
 * Prices the sale the way the server will and refuses what the till must not
 * store: a total that is not the sum of its lines, a discount on a catalog row
 * that has no tax rate yet, a discount above what this cashier may give.
 * (The server accepts a sale it disagrees with and flags it; the till is the
 * last place a wrong total can still be fixed by the person at the register.)
 */
export function priceAndCheckSale(
  sale: Pick<ValidatedSale, 'items' | 'invoiceDiscount' | 'localTotal'>,
  policy: { role: string; maxDiscountPercent: number },
): PricedCart {
  if (hasAnyDiscount(sale.items, sale.invoiceDiscount) && lineWithoutTaxRate(sale.items)) {
    throw new PosSaleValidationError('DISCOUNT_NEEDS_CATALOG', 'نفّذ مزامنة الكتالوج أولًا: بيانات ضريبة بعض الأصناف غير مكتملة لحساب الخصم.')
  }
  const priced = priceCart(sale.items, sale.invoiceDiscount)
  if (!Number.isFinite(sale.localTotal) || toCents(sale.localTotal) !== toCents(priced.total)) {
    throw new PosSaleValidationError('TOTAL_MISMATCH', 'Sale total does not match the immutable local price snapshots')
  }
  if (exceedsDiscountLimit(priced, discountLimitFor(policy.role, policy.maxDiscountPercent))) {
    throw new PosSaleValidationError('DISCOUNT_ABOVE_LIMIT', 'الخصم أعلى من الحد المسموح للكاشير. اطلب مديرًا لمنح هذا الخصم.')
  }
  return priced
}

export interface SaleCommandInput {
  sale: ValidatedSale
  payments: readonly SalePayment[]
  branchId: string
  shiftId: string
  cashierId: string
  cashierName: string
  sellerName: string
  offlineSessionId: string
  terminalSequence: string
  invoiceNumber: string
  occurredAt: string
}

/** The sale command the server's `POST /pos/sale` accepts (docs/design/W3-api.md section 1). */
export function buildSaleCommand(input: SaleCommandInput) {
  const { sale } = input
  return {
    event_version: 2,
    sync_id: sale.syncId,
    branch_id: input.branchId,
    shift_id: input.shiftId,
    origin_cashier_id: input.cashierId,
    cashier_name_snapshot: input.cashierName,
    seller_id: sale.sellerId,
    seller_name_snapshot: input.sellerName,
    offline_session_id: input.offlineSessionId,
    terminal_sequence: input.terminalSequence,
    invoice_number: input.invoiceNumber,
    occurred_at: input.occurredAt,
    customer_phone: sale.customerPhone,
    items: sale.items.map(saleItemCommand),
    discount: sale.invoiceDiscount ?? undefined,
    payments: input.payments.map(({ method, amount, tendered, reference }) => ({ method, amount, tendered, reference })),
    language: sale.language,
    local_total: sale.localTotal,
  }
}
