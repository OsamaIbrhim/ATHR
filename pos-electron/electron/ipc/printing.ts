import { BrowserWindow, ipcMain } from 'electron'
import { formatMoney, fromCents, lineCents } from '../money'

export function registerPrintingIpc() {
  ipcMain.handle('pos:print', async (_e, invoice: any, lang: 'ar' | 'en' = 'ar') => {
    const isAr = lang === 'ar'
    const escapeHtml = (value: unknown) =>
      String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
    const itemsHtml = (invoice.items || [])
      .map(
        (item: any) =>
          `<tr><td>${escapeHtml(item.name || item.sku)}</td><td>${Number(item.qty)}</td><td>${formatMoney(item.unit_price || 0)}</td><td>${formatMoney(fromCents(lineCents(item.unit_price || 0, Number(item.qty))))}</td></tr>`,
      )
      .join('')
    const payment = (
      {
        cash: 'نقدي',
        card: 'بطاقة',
        instapay: 'InstaPay',
        vodafone_cash: 'فودافون كاش',
        installment: 'تقسيط',
      } as Record<string, string>
    )[invoice.payment_method] || invoice.payment_method || ''
    const cashInfo =
      invoice.received !== undefined
        ? `<div>${isAr ? 'المستلم' : 'Received'}: ${Number(invoice.received).toFixed(2)}<br>${isAr ? 'الباقي' : 'Change'}: ${Number(invoice.change || 0).toFixed(2)}</div>`
        : ''
    const html = `<!doctype html>
  <html lang="${isAr ? 'ar' : 'en'}" dir="${isAr ? 'rtl' : 'ltr'}">
  <head>
    <meta charset="utf-8">
    <style>
      @page{size:80mm auto;margin:2mm}
      body{font-family:Arial,sans-serif;width:72mm;margin:0;font-size:12px}
      h2{text-align:center;margin:4px 0}
      table{width:100%;border-collapse:collapse}
      th,td{padding:2px 0;font-size:11px}
      th{border-bottom:1px dashed #000}
      .totals{margin-top:6px;border-top:1px dashed #000;padding-top:4px}
      .center{text-align:center}
      .small{font-size:10px}
    </style>
  </head>
  <body>
    <h2>ATHR</h2>
    <div class="center small">
      ملابس رجالي – Men's Clothing<br>
      ${isAr ? 'فاتورة' : 'Invoice'} ${escapeHtml(invoice.invoice_number || '')}<br>
      ${new Date(invoice.occurred_at || Date.now()).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}
    </div>
    <hr>
    <table>
      <thead>
        <tr>
          <th>${isAr ? 'الصنف' : 'Item'}</th>
          <th>${isAr ? 'ك' : 'Q'}</th>
          <th>${isAr ? 'السعر' : 'Price'}</th>
          <th>${isAr ? 'الإجمالي' : 'Total'}</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    <div class="totals">
      ${isAr ? 'الإجمالي' : 'Total'}: <b>${formatMoney(invoice.total || 0)} ${isAr ? 'ج' : 'EGP'}</b><br>
      ${isAr ? 'الدفع' : 'Payment'}: ${escapeHtml(payment)}${cashInfo}<br>
      <span class="small">${isAr ? 'شامل الضريبة' : 'VAT included'}</span>
    </div>
    <hr>
    <div class="center small">
      ${isAr ? 'سياسة الإرجاع: 14 يوم بحالة الشراء الأصلية' : 'Returns: 14 days original condition'}<br>
      شكرًا لاستخدامكم ATHR – Thank you
    </div>
  </body>
  </html>`
    const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
    try {
      await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      const result = await new Promise<{ success: boolean, reason?: string }>((resolve) => {
        let settled = false
        const finish = (success: boolean, reason?: string) => {
          if (settled) return
          settled = true
          resolve({ success, reason })
        }
        printWin.once('closed', () => finish(false, 'Print window was closed'))
        printWin.webContents.print({ silent: false, printBackground: false }, (success, reason) =>
          finish(success, reason),
        )
      })
      if (!printWin.isDestroyed()) printWin.destroy()
      if (!result.success) return { ok: false, printed: false, reason: result.reason || 'Print cancelled' }
    } catch (error: any) {
      if (!printWin.isDestroyed()) printWin.destroy()
      return { ok: false, printed: false, reason: error?.message || 'Unable to print' }
    }
    console.log('[CASH DRAWER] Kick through printer driver')
    return { ok: true, printed: true }
  })
}
