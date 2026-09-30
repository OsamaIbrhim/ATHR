import { ipcMain } from 'electron'
import { scan } from '../db/scan'
import { get, q } from '../db/queries'

export function registerCatalogIpc() {
  ipcMain.handle('pos:scan', (_event, term: string) => scan(term))

  ipcMain.handle('pos:stock', (_event, variantId: string) =>
    Number(get(`SELECT qty FROM stock WHERE variant_id=?`, [variantId])?.qty || 0),
  )

  ipcMain.handle('pos:list_sellers', () =>
    q(`SELECT id,name FROM sellers ORDER BY name,id`),
  )
}
