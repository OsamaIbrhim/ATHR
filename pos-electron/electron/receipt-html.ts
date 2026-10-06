import { BRAND_NAME } from './brand'
import { formatMoney, toCents } from './money'
import { paymentLabel } from './payment-methods'
import type { ReceiptSettings, SaleSettings } from './sale-settings'

/** One receipt line: what the customer paid for it before any discount (tax included). */
export interface ReceiptLine {
  name: string
  label?: string | null
  qty: number
  uom_name_ar?: string | null
  /** Unit price, tax included. */
  unit_price: number
  /** qty x unit price, tax included, before discounts. */
  amount: number
}

export interface ReceiptPayment {
  method: string
  amount: number
  /** Cash handed over (cash only). */
  tendered?: number
}

/** Everything a receipt shows; money in pounds. The same shape serves a new sale and a reprint. */
export interface ReceiptData {
  invoice_number: string
  occurred_at: string
  lines: ReceiptLine[]
  /** Net before discounts. */
  subtotal: number
  /** Net discount (lines + invoice). */
  discount: number
  tax: number
  total: number
  payments: ReceiptPayment[]
  /** Change given back on cash. */
  change?: number
  customer?: string | null
}

/** "Powered by Athar" line, printed when the tenant has not removed it (receipt.show_branding). */
export const BRANDING_LINE = 'بواسطة أثر · Powered by Athar'

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

const STYLE = `
  @page{size:80mm auto;margin:2mm}
  body{font-family:Arial,sans-serif;width:72mm;margin:0;font-size:12px}
  h2{text-align:center;margin:4px 0}
  table{width:100%;border-collapse:collapse}
  th,td{padding:2px 0;font-size:11px;vertical-align:top}
  th{border-bottom:1px dashed #000}
  .totals{margin-top:6px;border-top:1px dashed #000;padding-top:4px}
  .row{display:flex;justify-content:space-between}
  .grand{font-size:14px;font-weight:bold;margin-top:2px}
  .center{text-align:center}
  .small{font-size:10px}
  .brand{margin-top:4px;font-size:9px;color:#444}
`

function returnPolicy(days: number, isAr: boolean): string {
  if (days <= 0) return isAr ? 'لا يُقبل الإرجاع' : 'No returns'
  return isAr ? `سياسة الإرجاع: ${days} يوم بحالة الشراء الأصلية` : `Returns: ${days} days in original condition`
}

/**
 * The receipt page for the thermal printer. Pure (no Electron): the store
 * name, footer, tax breakdown and branding line come from the tenant's
 * settings, so the same function prints the till's receipt and renders the
 * preview in the tests and screenshots.
 */
export function buildReceiptHtml(
  data: ReceiptData,
  settings: { receipt: ReceiptSettings; sales: Pick<SaleSettings, 'return_window_days'> },
  lang: 'ar' | 'en' = 'ar',
): string {
  const isAr = lang === 'ar'
  const t = (ar: string, en: string) => (isAr ? ar : en)
  const currency = t('ج', 'EGP')
  const { receipt } = settings
  const money = (value: number) => `${formatMoney(value)} ${currency}`

  const lines = data.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.name)}${line.label ? `<br><span class="small">${escapeHtml(line.label)}</span>` : ''}</td>` +
        `<td>${Number(line.qty)}${line.uom_name_ar ? ` <span class="small">${escapeHtml(line.uom_name_ar)}</span>` : ''}</td>` +
        `<td>${formatMoney(line.unit_price)}</td><td>${formatMoney(line.amount)}</td></tr>`,
    )
    .join('')

  // With the breakdown the customer sees net, discount and tax; without it the
  // lines already include tax and only the discount (as a gross figure) and the total show.
  const grossDiscount = Math.round((data.lines.reduce((sum, line) => sum + toCents(line.amount), 0) - toCents(data.total))) / 100
  const summary = receipt.show_tax_breakdown
    ? `<div class="row"><span>${t('الإجمالي قبل الضريبة', 'Subtotal')}</span><span>${money(data.subtotal)}</span></div>` +
      (data.discount > 0 ? `<div class="row"><span>${t('الخصم', 'Discount')}</span><span>-${money(data.discount)}</span></div>` : '') +
      `<div class="row"><span>${t('الضريبة', 'VAT')}</span><span>${money(data.tax)}</span></div>`
    : grossDiscount > 0
      ? `<div class="row"><span>${t('الخصم', 'Discount')}</span><span>-${money(grossDiscount)}</span></div>`
      : ''

  const payments = data.payments
    .map(
      (payment) =>
        `<div class="row"><span>${escapeHtml(paymentLabel(payment.method))}</span><span>${money(payment.amount)}</span></div>` +
        (payment.tendered !== undefined && payment.tendered > payment.amount
          ? `<div class="row small"><span>${t('المستلم', 'Received')}</span><span>${money(payment.tendered)}</span></div>`
          : ''),
    )
    .join('')
  const change = data.change && data.change > 0 ? `<div class="row"><span>${t('الباقي', 'Change')}</span><span>${money(data.change)}</span></div>` : ''

  const storeName = receipt.store_name || BRAND_NAME
  const footer = receipt.footer ? `${escapeHtml(receipt.footer)}<br>` : `${t('شكرًا لزيارتكم', 'Thank you')}<br>`
  const branding = receipt.show_branding ? `<div class="center brand">${BRANDING_LINE}</div>` : ''

  return `<!doctype html>
<html lang="${lang}" dir="${isAr ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8">
  <style>${STYLE}</style>
</head>
<body>
  <h2>${escapeHtml(storeName)}</h2>
  <div class="center small">
    ${t('فاتورة', 'Invoice')} ${escapeHtml(data.invoice_number)}<br>
    ${new Date(data.occurred_at || Date.now()).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}
    ${data.customer ? `<br>${escapeHtml(data.customer)}` : ''}
  </div>
  <hr>
  <table>
    <thead>
      <tr><th>${t('الصنف', 'Item')}</th><th>${t('ك', 'Q')}</th><th>${t('السعر', 'Price')}</th><th>${t('الإجمالي', 'Total')}</th></tr>
    </thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="totals">
    ${summary}
    <div class="row grand"><span>${t('الإجمالي', 'Total')}</span><span>${money(data.total)}</span></div>
    ${payments}${change}
    ${receipt.show_tax_breakdown ? '' : `<div class="small">${t('شامل الضريبة', 'VAT included')}</div>`}
  </div>
  <hr>
  <div class="center small">
    ${returnPolicy(settings.sales.return_window_days, isAr)}<br>
    ${footer}
  </div>
  ${branding}
</body>
</html>`
}
