import { ipcMain } from 'electron'
import { posSettings } from '../db/tenant-settings'

/** The sale and receipt settings the till works with (payment methods, discount limit, receipt text). */
export function registerSettingsIpc() {
  ipcMain.handle('pos:settings', () => posSettings())
}
