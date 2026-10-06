import { describe, expect, it } from 'vitest'
import { receiptFromCart, receiptFromInvoice } from './receipt-data'
import { BRANDING_LINE, buildReceiptHtml } from './receipt-html'
import { DEFAULT_POS_SETTINGS, type PosSettings } from './sale-settings'

const line = (over: Record<string, unknown> = {}) => ({
  variant_id: 'v1',
  name: 'قميص <b>',
  label: 'L · أسود',
  qty: 2,
  unit_price: 100,
  unit_tax: 14,
  tax_rate: '14',
  tax_mode: 'exclusive',
  ...over,
})

const settings = (receipt: Partial<PosSettings['receipt']> = {}, days = 14): PosSettings => ({
  sales: { ...DEFAULT_POS_SETTINGS.sales, return_window_days: days },
  receipt: { ...DEFAULT_POS_SETTINGS.receipt, store_name: 'متجر النور', ...receipt },
})

const sale = receiptFromCart({
  invoiceNumber: 'POS1-000042',
  occurredAt: '2026-10-06T10:00:00.000Z',
  lines: [line(), line({ variant_id: 'v2', name: 'حزام', label: null, qty: 1, unit_price: 50, unit_tax: 7 })],
  invoiceDiscount: { type: 'amount', value: 25 },
  payments: [
    { method: 'cash', amount: 100, tendered: 200 },
    { method: 'card', amount: 126.5 },
  ],
  customer: 'سارة',
})

describe('receiptFromCart', () => {
  it('prices the sale with the shared arithmetic and keeps lines gross, before discounts', () => {
    expect(sale.subtotal).toBe(250)
    expect(sale.discount).toBe(25)
    expect(sale.tax).toBe(31.5)
    expect(sale.total).toBe(256.5)
    expect(sale.lines.map((l) => l.amount)).toEqual([228, 57])
    expect(sale.lines[0]!.unit_price).toBe(114)
    expect(sale.change).toBe(100)
  })
})

describe('buildReceiptHtml', () => {
  it('prints the store name, the printed invoice number, payments, change and the branding line', () => {
    const html = buildReceiptHtml(sale, settings())
    expect(html).toContain('متجر النور')
    expect(html).toContain('POS1-000042')
    expect(html).toContain('نقدي')
    expect(html).toContain('بطاقة')
    expect(html).toContain('الباقي')
    expect(html).toContain('الخصم')
    expect(html).toContain(BRANDING_LINE)
    expect(html).toContain('بواسطة أثر · Powered by Athar')
  })

  it('drops the branding line only when the tenant turned it off', () => {
    expect(buildReceiptHtml(sale, settings({ show_branding: false }))).not.toContain('Powered by Athar')
  })

  it('shows the tax breakdown, or only the gross lines when it is off', () => {
    const withBreakdown = buildReceiptHtml(sale, settings({ show_tax_breakdown: true }))
    expect(withBreakdown).toContain('الضريبة')
    expect(withBreakdown).toContain('الإجمالي قبل الضريبة')
    const without = buildReceiptHtml(sale, settings({ show_tax_breakdown: false }))
    expect(without).not.toContain('الإجمالي قبل الضريبة')
    expect(without).toContain('شامل الضريبة')
    expect(without).toContain('-28.50') // the gross discount: 285.00 of lines - 256.50 total
  })

  it('uses the tenant footer and the return window of the settings', () => {
    const html = buildReceiptHtml(sale, settings({ footer: 'نشكركم على ثقتكم' }, 30))
    expect(html).toContain('نشكركم على ثقتكم')
    expect(html).toContain('30 يوم')
    expect(buildReceiptHtml(sale, settings({}, 0))).toContain('لا يُقبل الإرجاع')
  })

  it('escapes what the cashier or catalog typed', () => {
    const html = buildReceiptHtml(sale, settings())
    expect(html).toContain('قميص &lt;b&gt;')
    expect(html).not.toContain('قميص <b>')
  })
})

describe('receiptFromInvoice', () => {
  it('rebuilds a receipt from a stored invoice, including its payments', () => {
    const receipt = receiptFromInvoice({
      invoice_number: 'POS1-000007',
      created_at: '2026-10-06T10:00:00.000Z',
      subtotal: '100.00',
      discount_amount: '10.00',
      tax_amount: '12.60',
      total: '102.60',
      items: [{ qty: 1, unit_price: '100.00', unit_tax: '14.00', name: 'قميص' }],
      payments: [{ method: 'cash', amount: '102.60', tendered: '110.00' }],
    })
    expect(receipt.total).toBe(102.6)
    expect(receipt.lines[0]!.amount).toBe(114)
    expect(receipt.change).toBe(7.4)
    expect(buildReceiptHtml(receipt, settings())).toContain('POS1-000007')
  })
})
