import { app, ipcMain } from 'electron'
import { applyCatalogPull } from '../db/catalog-sync'
import { catalogNeedsFullRefresh } from '../db/catalog'
import {
  markFailed,
  markSending,
  markSent,
  outboxCounts,
  outboxTerminalSequence,
  pendingOutbox,
  syncStatusMeta,
  updateSyncStatus,
} from '../db/outbox'
import { assertFactoryResetIdle } from '../factory-reset-runtime'
import { minorUnitsToDecimal } from '../money-codec'
import { updateSecureAcknowledgedSequence } from '../sale-sequence'

function uniqueWarningCodes(value: unknown) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((code) => String(code || '').trim())
        .filter(Boolean),
    ),
  )
}

export function registerSyncIpc() {
  ipcMain.handle('sync:get_outbox', () =>
    pendingOutbox().map((row) => {
      const { local_total_minor_units, ...rest } = row
      return {
        ...rest,
        local_total:
          local_total_minor_units === null || local_total_minor_units === undefined
            ? null
            : Number(minorUnitsToDecimal(Number(local_total_minor_units))),
      }
    }),
  )

  ipcMain.handle('sync:mark_sending', (_event, id: string) => {
    assertFactoryResetIdle()
    markSending(id)
    return { ok: true }
  })

  ipcMain.handle(
    'sync:mark_sent',
    (
      _event,
      result: {
        id: string
        server_document_id?: string | null
        server_document_number?: string | null
        warning_codes?: string[]
      },
    ) => {
      assertFactoryResetIdle()
      const terminalSequence = outboxTerminalSequence(result.id)
      markSent({
        id: result.id,
        serverDocumentId: result.server_document_id || null,
        serverDocumentNumber: result.server_document_number || null,
        warningCodes: uniqueWarningCodes(result.warning_codes),
      })
      if (terminalSequence) updateSecureAcknowledgedSequence(terminalSequence)
      return { ok: true }
    },
  )

  ipcMain.handle(
    'sync:mark_failed',
    (_event, input: { id: string; error: string; retryable: boolean }) => {
      assertFactoryResetIdle()
      markFailed(input.id, input.error, input.retryable)
      return { ok: true }
    },
  )

  ipcMain.handle('sync:get_status', () => {
    const counts = outboxCounts()
    const meta = syncStatusMeta()
    // A null cursor makes the next normal sync request a full snapshot. This
    // also self-heals a partially corrupted local catalog.
    const refreshRequired = catalogNeedsFullRefresh()
    return {
      device_id: meta.device_id,
      terminal_name: meta.terminal_name,
      app_version: app.getVersion(),
      sync_status: meta.sync_status,
      last_sync_at: meta.last_sync_at,
      last_error: meta.last_error,
      pending_count: counts.pending,
      quarantined_count: counts.quarantined,
      terminal_sale_sequence: meta.terminal_sale_sequence,
      sync_cursor: refreshRequired ? null : meta.sync_cursor,
      catalog_valid_until: refreshRequired ? null : meta.catalog_valid_until,
    }
  })

  ipcMain.handle('sync:set_status', (_event, status: any) => {
    assertFactoryResetIdle()
    updateSyncStatus(status)
    return { ok: true }
  })

  ipcMain.handle('sync:apply_pull', (_event, data: any) => {
    assertFactoryResetIdle()
    applyCatalogPull(data)
    return { ok: true }
  })
}
