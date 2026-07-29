import { app, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  assertFactoryResetAllowed,
  FactoryResetPolicyError,
  factoryResetStatus,
} from './factory-reset-policy'

type FactoryResetDependencies = {
  dbPath: () => string
  secureStatePath: () => string
  getSecureState: () => any
  query: (sql: string, params?: any[]) => any[]
  getMeta: (key: string) => string
  saveDb: () => void
  closeDb: () => void
  reopenDb: () => void
  decommission: (payload: {
    device_id: string
    terminal_code: string
    pending_count: number
    held_count: number
  }) => Promise<any>
  envelope: (operation: () => any | Promise<any>) => Promise<any>
}

let registered = false
let resetInProgress = false

export function assertFactoryResetIdle() {
  if (resetInProgress) {
    throw new FactoryResetPolicyError(
      'FACTORY_RESET_IN_PROGRESS',
      'لا يمكن تعديل المبيعات أثناء إلغاء تسجيل الجهاز.',
    )
  }
}

function numberFromQuery(
  dependencies: FactoryResetDependencies,
  sql: string,
) {
  return Number(dependencies.query(sql)?.[0]?.count || 0)
}

function currentFacts(dependencies: FactoryResetDependencies) {
  const secure = dependencies.getSecureState() || {}
  return {
    role: secure.auth?.session?.user?.role || null,
    terminalCode: secure.device?.terminal_code || null,
    pendingCount: numberFromQuery(
      dependencies,
      `SELECT COUNT(*) AS count FROM outbox WHERE sync_status<>'sent'`,
    ),
    heldCount: numberFromQuery(
      dependencies,
      `SELECT COUNT(*) AS count FROM held_sales`,
    ),
    syncStatus: dependencies.getMeta('sync_status') || 'never',
    inProgress: resetInProgress,
  }
}

function stagedName(source: string) {
  return `${source}.factory-reset-${Date.now()}`
}

function bestEffortRemove(target: string) {
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (error) {
    console.warn(
      `[FACTORY_RESET_CLEANUP] ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export function cleanupFactoryResetArtifacts() {
  const directory = app.getPath('userData')
  let names: string[] = []
  try {
    names = fs.readdirSync(directory)
  } catch {
    return
  }
  for (const name of names) {
    if (
      name.startsWith('athr_pos.sqlite.factory-reset-') ||
      name.startsWith('bold_pos.sqlite.factory-reset-') ||
      name.startsWith('secure-state.bin.factory-reset-')
    ) {
      bestEffortRemove(path.join(directory, name))
    }
  }
}

export function registerFactoryResetIpc(
  dependencies: FactoryResetDependencies,
) {
  if (registered) return
  registered = true

  ipcMain.handle(
    'api:factory_reset_status',
    () => dependencies.envelope(() =>
      factoryResetStatus(currentFacts(dependencies)),
    ),
  )

  ipcMain.handle(
    'api:factory_reset',
    (_event, confirmation: string) =>
      dependencies.envelope(async () => {
        const facts = currentFacts(dependencies)
        const status = assertFactoryResetAllowed(
          facts,
          confirmation,
        )
        const secure = dependencies.getSecureState() || {}
        const device = secure.device
        if (!device?.device_id || !device?.terminal_code) {
          throw new FactoryResetPolicyError(
            'FACTORY_RESET_DEVICE_REQUIRED',
            'تعذر قراءة هوية الجهاز المسجل.',
          )
        }

        resetInProgress = true
        try {
          try {
            await dependencies.decommission({
              device_id: device.device_id,
              terminal_code: device.terminal_code,
              pending_count: status.pending_count,
              held_count: status.held_count,
            })
          } catch (error: any) {
            // A previous attempt may have revoked the backend credential after
            // local cleanup failed. In that case it remains safe to finish the
            // already-authorized local wipe after rechecking all local queues.
            if (error?.code !== 'TERMINAL_REVOKED') throw error
          }

          dependencies.saveDb()
          dependencies.closeDb()

          const database = dependencies.dbPath()
          const secureState = dependencies.secureStatePath()
          const stagedDatabase = stagedName(database)
          const stagedSecure = stagedName(secureState)
          let databaseMoved = false
          let secureMoved = false

          try {
            if (fs.existsSync(database)) {
              fs.renameSync(database, stagedDatabase)
              databaseMoved = true
            }
            if (fs.existsSync(secureState)) {
              fs.renameSync(secureState, stagedSecure)
              secureMoved = true
            }
          } catch (error) {
            try {
              if (secureMoved && !fs.existsSync(secureState)) {
                fs.renameSync(stagedSecure, secureState)
              }
              if (databaseMoved && !fs.existsSync(database)) {
                fs.renameSync(stagedDatabase, database)
              }
            } finally {
              dependencies.reopenDb()
            }
            throw new FactoryResetPolicyError(
              'FACTORY_RESET_LOCAL_CLEANUP_FAILED',
              `تعذر تجهيز ملفات الجهاز للمسح الآمن: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          }

          bestEffortRemove(path.join(app.getPath('userData'), 'updates'))
          if (secureMoved) bestEffortRemove(stagedSecure)
          if (databaseMoved) bestEffortRemove(stagedDatabase)

          app.relaunch()
          setImmediate(() => app.exit(0))
          return { restarting: true }
        } catch (error) {
          resetInProgress = false
          throw error
        }
      }),
  )
}
