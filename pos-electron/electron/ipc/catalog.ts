import { ipcMain } from 'electron'
import { searchProducts } from '../db/catalog'
import { get, q } from '../db/queries'

export function registerCatalogIpc() {
  ipcMain.handle('pos:search', (_event, term: string) => searchProducts(term))

  ipcMain.handle('pos:stock', (_event, variantId: string) =>
    Number(get(`SELECT qty FROM stock WHERE variant_id=?`, [variantId])?.qty || 0),
  )

  ipcMain.handle('pos:list_sellers', () =>
    q(`SELECT id,name FROM sellers ORDER BY name,id`),
  )
}
