import type { Discount } from '../../../electron/sale-math'
import type { SalePayment } from '../../../electron/sale-payments'
import type { CartItem } from '../../types'

/** The sale the register hands to the main process (validated and priced again there). */
export function buildSalePayload(input: {
  items: CartItem[]
  invoiceDiscount: Discount | null
  payments: SalePayment[]
  branchId: string
  sellerId: string
  customerPhone?: string
  total: number
}) {
  return {
    sync_id: crypto.randomUUID(),
    branch_id: input.branchId,
    seller_id: input.sellerId,
    customer_phone: input.customerPhone,
    items: input.items.map((item) => ({
      variant_id: item.variant_id,
      qty: item.qty,
      unit_price: item.unit_price,
      unit_tax: item.unit_tax,
      tax_rate: item.tax_rate ?? undefined,
      tax_mode: item.tax_mode ?? undefined,
      discount: item.discount ?? undefined,
      sku: item.sku,
      name_ar: item.name_ar || item.name,
      name_en: item.name_en || '',
      label: item.label || undefined,
    })),
    discount: input.invoiceDiscount ?? undefined,
    payments: input.payments,
    language: 'ar',
    local_total: input.total,
  }
}
