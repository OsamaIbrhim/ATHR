import { app, dialog } from 'electron'
import { POS_APP_NAME } from './brand'
import { apiConfiguration } from './deployment-config'
import { openLocalDatabase } from './db-startup'
import { cleanupFactoryResetArtifacts } from './factory-reset-runtime'
import { registerAllIpc } from './ipc'
import { pinDataDirectory } from './paths'
import { ensureAutoUpdates } from './updates'
import { createWindow } from './window'

// Before anything touches userData: the data folder must not follow the brand name.
pinDataDirectory()

app.whenReady().then(() => {
  apiConfiguration()
  cleanupFactoryResetArtifacts()
  try {
    openLocalDatabase()
  } catch (error) {
    // Never run against a database that failed to open or migrate; the
    // original file is left untouched.
    dialog.showErrorBox(
      POS_APP_NAME,
      `تعذر فتح قاعدة بيانات الجهاز. لم يتم تعديل أي بيانات.\n${app.getPath('userData')}\n${
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
