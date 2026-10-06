import { BrowserWindow, ipcMain } from 'electron'
import { posSettings } from '../db/tenant-settings'
import { buildReceiptHtml, type ReceiptData } from '../receipt-html'

/** Prints a receipt (`ReceiptData` from the register or a reprint) with the tenant's receipt settings. */
export function registerPrintingIpc() {
  ipcMain.handle('pos:print', async (_e, receipt: ReceiptData, lang: 'ar' | 'en' = 'ar') => {
    const html = buildReceiptHtml(receipt, posSettings(), lang)
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
