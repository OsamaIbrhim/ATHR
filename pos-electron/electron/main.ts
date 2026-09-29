import { app, dialog } from 'electron'
import { apiConfiguration } from './deployment-config'
import { openLocalDatabase } from './db-startup'
import { cleanupFactoryResetArtifacts } from './factory-reset-runtime'
import { registerAllIpc } from './ipc'
import { migrateLegacyLocalState } from './local-state-migration'
import { ensureAutoUpdates } from './updates'
import { createWindow } from './window'

app.whenReady().then(() => {
  migrateLegacyLocalState({
    appDataDirectory: app.getPath('appData'),
    targetDirectory: app.getPath('userData'),
  })
  apiConfiguration()
  cleanupFactoryResetArtifacts()
  try {
    openLocalDatabase()
  } catch (error) {
    // Never run against a database that failed to open or migrate; the
    // original file (and its pre-migration backup) is left untouched.
    dialog.showErrorBox(
      'ATHR POS',
      `تعذر فتح قاعدة بيانات الجهاز. لم يتم تعديل أي بيانات.\n${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    app.exit(1)
    return
  }
  registerAllIpc()
  createWindow()
  ensureAutoUpdates()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
