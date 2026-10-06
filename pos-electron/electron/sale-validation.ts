import { cleanDiscount, type Discount } from './sale-math'
import { isValidQuantity } from './quantity'
import { PosSaleValidationError } from './sale-error'
import { parsePayments } from './sale-payments'

export { PosSaleValidationError }

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EGYPTIAN_PHONE =
  /^(?:\+20|0)1[0125]\d{8}$/

export function validateLocalSaleInput(
  sale: any,
  enrolledBranchId: string,
) {
  const syncId = String(sale?.sync_id || '')
  const branchId = String(sale?.branch_id || '')
  const sellerId = String(sale?.seller_id || '')
  const customerPhone = sale?.customer_phone
    ? String(sale.customer_phone)
        .trim()
        .replace(/\s+/g, '')
    : undefined

  if (!UUID.test(syncId)) {
    throw new PosSaleValidationError(
      'INVALID_SYNC_ID',
      'تعذر إنشاء مرجع آمن للبيع. أعد المحاولة.',
    )
  }
  if (
    !UUID.test(branchId) ||
    branchId !== enrolledBranchId
  ) {
    throw new PosSaleValidationError(
      'BRANCH_MISMATCH',
      'هذا الجهاز غير مسجل على الفرع المحدد.',
    )
  }
  if (!UUID.test(sellerId)) {
    throw new PosSaleValidationError(
      'SELLER_REQUIRED',
      'اختر البائع قبل إتمام الفاتورة.',
    )
  }
  if (
    customerPhone &&
    !EGYPTIAN_PHONE.test(customerPhone)
  ) {
    throw new PosSaleValidationError(
      'CUSTOMER_PHONE_INVALID',
      'رقم هاتف العميل غير صحيح.',
    )
  }
  if (
    !Array.isArray(sale?.items) ||
    sale.items.length < 1 ||
    sale.items.length > 100
  ) {
    throw new PosSaleValidationError(
      'SALE_ITEMS_INVALID',
      'يجب أن تحتوي الفاتورة على صنف واحد إلى 100 صنف.',
    )
  }

  const seen = new Set<string>()
  const items = sale.items.map((item: any) => {
    const normalized = {
      variant_id: String(item?.variant_id || ''),
      qty: Number(item?.qty),
      unit_price: Number(item?.unit_price),
      unit_tax: Number(item?.unit_tax),
      sku: String(item?.sku || '').trim(),
      name_ar: String(item?.name_ar || '').trim(),
      name_en: String(item?.name_en || '').trim(),
      label: item?.label ? String(item.label).trim() : undefined,
      tax_rate: item?.tax_rate === undefined || item?.tax_rate === null ? null : String(item.tax_rate),
      tax_mode: item?.tax_mode === 'inclusive' || item?.tax_mode === 'exclusive' ? (item.tax_mode as 'inclusive' | 'exclusive') : null,
      discount: parseDiscount(item?.discount),
    }
    if (
      !UUID.test(normalized.variant_id) ||
      !isValidQuantity(normalized.qty) ||
      !Number.isFinite(normalized.unit_price) ||
      normalized.unit_price <= 0 ||
      !Number.isFinite(normalized.unit_tax) ||
      normalized.unit_tax < 0 ||
      !normalized.sku ||
      (!normalized.name_ar && !normalized.name_en)
    ) {
      throw new PosSaleValidationError(
        'SALE_ITEM_INVALID',
        'توجد كمية أو هوية صنف أو لقطة سعر غير صحيحة في الفاتورة.',
      )
    }
    if (seen.has(normalized.variant_id)) {
      throw new PosSaleValidationError(
        'DUPLICATE_SALE_ITEM',
        'لا يمكن تكرار الصنف كسطرين منفصلين في الفاتورة.',
      )
    }
    seen.add(normalized.variant_id)
    return normalized
  })

  return {
    syncId,
    branchId,
    sellerId,
    customerPhone,
    invoiceDiscount: parseDiscount(sale?.discount),
    payments: parsePayments(sale?.payments),
    language: sale?.language === 'en' ? 'en' as const : 'ar' as const,
    localTotal: Number(sale?.local_total),
    items,
  }
}

/** A discount as the register sends it: absent, or a positive amount / a percent up to 100. Anything else is refused. */
function parseDiscount(raw: any): Discount | null {
  if (raw === undefined || raw === null) return null
  const discount = cleanDiscount(String(raw?.type), raw?.value)
  if (!discount) {
    throw new PosSaleValidationError('DISCOUNT_INVALID', 'قيمة الخصم غير صحيحة.')
  }
  return discount
}

type ValidatedSaleItem = ReturnType<typeof validateLocalSaleInput>['items'][number]

/** One sale line as the backend's CreateSaleItemDto expects it (label snapshot). */
export function saleItemCommand(item: ValidatedSaleItem) {
  return {
    variant_id: item.variant_id,
    qty: item.qty,
    unit_price: item.unit_price,
    unit_tax: item.unit_tax,
    sku_snapshot: item.sku,
    name_ar_snapshot: item.name_ar,
    name_en_snapshot: item.name_en || undefined,
    variant_label_snapshot: item.label || undefined,
    discount: item.discount ?? undefined,
  }
}
