import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { assertFactoryResetIdle } from '../factory-reset-runtime'
import {
  currentHeldSaleScope,
  deleteHeldSale,
  findHeldSale,
  hydrateHeldSale,
  insertHeldSale,
  listHeldSales,
} from '../held-sale-store'
import { sanitizeHeldSaleCustomer, validateHeldSaleItems } from '../held-sale'

export function registerHeldSalesIpc() {
  ipcMain.handle('pos:list_held_sales', () => listHeldSales(currentHeldSaleScope()))

  ipcMain.handle('pos:hold_sale', (_event, input: any) => {
    assertFactoryResetIdle()
    const scope = currentHeldSaleScope()
    const items = validateHeldSaleItems(input?.items)
    const customer = sanitizeHeldSaleCustomer(input?.customer)
    const now = new Date().toISOString()
    const row = {
      id: randomUUID(),
      ...scope,
      customer_json: customer ? JSON.stringify(customer) : null,
      items_json: JSON.stringify(items),
      created_at: now,
      updated_at: now,
    }
    // Hydration ignores renderer-supplied prices and reads the current signed
    // catalog and stock before accepting the draft.
    const hydrated = hydrateHeldSale(row)
    insertHeldSale(scope, row)
    return hydrated
  })

  ipcMain.handle('pos:resume_held_sale', (_event, id: string) => {
    assertFactoryResetIdle()
    const scope = currentHeldSaleScope()
    const row = findHeldSale(scope, String(id || ''))
    if (!row) {
      throw new Error('الفاتورة المعلقة غير موجودة في وردية هذا الكاشير.')
    }
    const hydrated = hydrateHeldSale(row)
    deleteHeldSale(scope, String(row.id))
    return hydrated
  })

  ipcMain.handle('pos:delete_held_sale', (_event, id: string) => {
    assertFactoryResetIdle()
    return { ok: deleteHeldSale(currentHeldSaleScope(), String(id || '')) }
  })
}
