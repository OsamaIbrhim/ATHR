import { app, clipboard, dialog, ipcMain } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  diagnosticFilename,
  redactDiagnostics,
  serializeDiagnostics,
} from './diagnostic-redaction'

type DiagnosticsDependencies = {
  apiBase: () => string
  protocolVersion: number
  dbPath: () => string
  getSecureState: () => any
  getMeta: (key: string) => string
  query: (sql: string, params?: any[]) => any[]
}

let registered = false

const RETRY_DELAYS_MS = [
  15_000,
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
]

function safeApiBase(value: string) {
  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`
  } catch {
    return 'invalid-api-base'
  }
}

function safeCount(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

function failureDetails(message: unknown) {
  const value = String(message || '')
  const code = value.match(/(?:^|\s|—|\|)code=([^\s|]+)/)?.[1] || null
  const httpStatus = Number(
    value.match(/(?:^|\s|—|\|)http=(\d{3})/)?.[1] || 0,
  )
  const requestId =
    value.match(/(?:^|\s|—|\|)request=([^\s|]+)/)?.[1] || null
  return {
    code,
    http_status: httpStatus || null,
    request_id: requestId,
  }
}

function nextAttemptAt(row: any) {
  if (String(row?.sync_status || '') !== 'pending') return null
  const attempt = safeCount(row?.attempt_count)
  const lastAttempt = Date.parse(String(row?.last_attempt_at || ''))
  if (!attempt || !Number.isFinite(lastAttempt)) return null
  const delay = RETRY_DELAYS_MS[
    Math.min(RETRY_DELAYS_MS.length - 1, attempt - 1)
  ]
  let hash = 2166136261
  const seed = `${String(row?.id || '')}:${attempt}`
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const jitterWindow = Math.max(1, Math.floor(delay * 0.2))
  const jitter = (hash >>> 0) % jitterWindow
  return new Date(lastAttempt + delay + jitter).toISOString()
}

function databaseSize(dbPath: string) {
  try {
    return fs.statSync(dbPath).size
  } catch {
    return 0
  }
}

function snapshot(
  dependencies: DiagnosticsDependencies,
  rendererState?: unknown,
) {
  const secure = dependencies.getSecureState() || {}
  const device = secure.device || null
  const user = secure.auth?.session?.user || null
  const accounting = secure.accounting || null
  const counts = dependencies.query(
    `SELECT sync_status AS status,COUNT(*) AS count
     FROM outbox
     GROUP BY sync_status`,
  )
  const unresolved = dependencies.query(
     `SELECT id,type,sync_status,created_at,attempt_count,
             last_attempt_at,last_error,terminal_sequence,updated_at,
             warning_codes
      FROM outbox
      WHERE sync_status IN ('pending','sending','quarantined')
     ORDER BY created_at
     LIMIT 20`,
  )
  const countMap = Object.fromEntries(
    counts.map((row) => [
      String(row.status || 'unknown'),
      safeCount(row.count),
    ]),
  )
  const unresolvedCount = Object.entries(countMap)
    .filter(([status]) =>
      ['pending', 'sending'].includes(status),
    )
    .reduce((sum, [, count]) => sum + safeCount(count), 0)
  const dbFile = dependencies.dbPath()
  const lastError = dependencies.getMeta('last_error') || null

  return redactDiagnostics({
    schema_version: 2,
    generated_at: new Date().toISOString(),
    application: {
      name: 'ATHR POS',
      version: app.getVersion(),
      protocol_version: dependencies.protocolVersion,
      api_base: safeApiBase(dependencies.apiBase()),
      packaged: app.isPackaged,
    },
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      os_release: os.release(),
      electron_version: process.versions.electron || null,
      node_version: process.versions.node,
    },
    paths: {
      user_data: app.getPath('userData'),
      database: dbFile,
      database_size_bytes: databaseSize(dbFile),
    },
    terminal: device
      ? {
          enrolled: true,
          device_id: device.device_id || null,
          terminal_id: device.terminal_id || null,
          terminal_code: device.terminal_code || null,
          branch_id: device.branch_id || null,
          tenant_id: device.tenant_id || null,
        }
      : { enrolled: false },
    session: user
      ? {
          authenticated: true,
          user_id: user.id || null,
          role: user.role || null,
          branch_id: user.branch_id || null,
        }
      : { authenticated: false },
    accounting: accounting
      ? {
          available: true,
          session_id: accounting.session_id || null,
          shift_id: accounting.shift_id || null,
          branch_id: accounting.branch_id || null,
          terminal_id: accounting.terminal_id || null,
          user_id: accounting.user_id || null,
          expires_at: accounting.expires_at || null,
          server_last_sale_sequence:
            accounting.server_last_sale_sequence || null,
        }
      : { available: false },
    sync: {
      status: dependencies.getMeta('sync_status') || 'never',
      last_sync_at: dependencies.getMeta('last_sync_at') || null,
      last_error: lastError,
      last_error_details: failureDetails(lastError),
      pending_count: unresolvedCount,
      cursor: dependencies.getMeta('sync_cursor') || null,
      catalog_valid_until:
        dependencies.getMeta('catalog_valid_until') || null,
      terminal_sale_sequence:
        dependencies.getMeta('terminal_sale_sequence') || '0',
    },
    outbox: {
      counts: countMap,
      unresolved: unresolved.map((row) => ({
        id: String(row.id || ''),
        type: String(row.type || ''),
        status: String(row.sync_status || ''),
        created_at: row.created_at || null,
        attempt_count: safeCount(row.attempt_count),
        last_attempt_at: row.last_attempt_at || null,
        next_attempt_at: nextAttemptAt(row),
        terminal_sequence: row.terminal_sequence || null,
        last_error: row.last_error || null,
        error_details: failureDetails(row.last_error),
        updated_at: row.updated_at || null,
        warning_codes: row.warning_codes || '[]',
      })),
    },
    renderer_state: rendererState || null,
  })
}

export function registerDiagnosticsIpc(
  dependencies: DiagnosticsDependencies,
) {
  if (registered) return
  registered = true

  ipcMain.handle(
    'diagnostics:get',
    () => snapshot(dependencies),
  )
  ipcMain.handle(
    'diagnostics:copy',
    (_event, rendererState: unknown) => {
      const content = serializeDiagnostics(
        snapshot(dependencies, rendererState),
      )
      clipboard.writeText(content)
      return { ok: true, bytes: Buffer.byteLength(content) }
    },
  )
  ipcMain.handle(
    'diagnostics:export',
    async (_event, rendererState: unknown) => {
      const content = serializeDiagnostics(
        snapshot(dependencies, rendererState),
      )
      const result = await dialog.showSaveDialog({
        title: 'تصدير تشخيص ATHR POS',
        defaultPath: path.join(
          app.getPath('documents'),
          diagnosticFilename(),
        ),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true }
      }
      fs.writeFileSync(result.filePath, content, {
        encoding: 'utf8',
        mode: 0o600,
      })
      return {
        ok: true,
        canceled: false,
        filename: path.basename(result.filePath),
      }
    },
  )
}
