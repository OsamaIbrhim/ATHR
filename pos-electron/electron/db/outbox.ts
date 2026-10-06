import { get, getMeta, q, run, setMeta, tx } from './queries'

export function pendingOutbox() {
  return q(`SELECT o.*,s.total_minor_units AS local_total_minor_units
     FROM outbox o
     LEFT JOIN sales_local s ON s.sync_id=o.id
     WHERE o.sync_status='pending'
     ORDER BY
       CASE WHEN o.terminal_sequence IS NULL THEN 0 ELSE 1 END,
       LENGTH(COALESCE(o.terminal_sequence,'')),
       o.terminal_sequence,
       o.created_at`)
}

export function markSending(id: string) {
  const now = new Date().toISOString()
  const changed = run(
    `UPDATE outbox
     SET sync_status='sending',
         attempt_count=COALESCE(attempt_count,0)+1,
         last_attempt_at=?,
         last_error=NULL,
         updated_at=?
     WHERE id=? AND sync_status='pending'`,
    [now, now, id],
  )
  if (changed !== 1) throw new Error(`Outbox operation is not pending: ${id}`)
}

export function outboxTerminalSequence(id: string) {
  return String(get(`SELECT terminal_sequence FROM outbox WHERE id=?`, [id])?.terminal_sequence || '')
}

export function markSent(input: {
  id: string
  serverDocumentId: string | null
  serverDocumentNumber: string | null
  warningCodes: string[]
}) {
  const now = new Date().toISOString()
  const syncResult = input.warningCodes.length ? 'sent_with_warning' : 'sent'
  const warningCodesJson = JSON.stringify(input.warningCodes)
  tx(() => {
    run(
      `UPDATE outbox
       SET sync_status=?,
           server_document_id=?,
           server_document_number=?,
           warning_codes=?,
           last_error=NULL,
           updated_at=?
       WHERE id=?`,
      [syncResult, input.serverDocumentId, input.serverDocumentNumber, warningCodesJson, now, input.id],
    )
    run(
      `UPDATE sales_local
       SET server_invoice_id=?,
           server_invoice_number=?,
           synced_at=?,
           sync_result=?,
           warning_codes=?
       WHERE sync_id=?`,
      [input.serverDocumentId, input.serverDocumentNumber, now, syncResult, warningCodesJson, input.id],
    )
  })
}

export function markFailed(id: string, error: string, retryable: boolean) {
  run(
    `UPDATE outbox
     SET sync_status=?,
         last_error=?,
         updated_at=?
     WHERE id=?`,
    [
      retryable ? 'pending' : 'quarantined',
      String(error || 'Unknown synchronization error').slice(0, 1000),
      new Date().toISOString(),
      id,
    ],
  )
}

export function outboxCounts() {
  return {
    pending: Number(
      get(`SELECT COUNT(*) AS count FROM outbox WHERE sync_status IN ('pending','sending')`)?.count || 0,
    ),
    quarantined: Number(
      get(`SELECT COUNT(*) AS count FROM outbox WHERE sync_status='quarantined'`)?.count || 0,
    ),
  }
}

/** A crash can leave an operation marked sending; the retry is idempotent on the server. */
export function requeueInterruptedSends() {
  run(`UPDATE outbox SET sync_status='pending',updated_at=? WHERE sync_status='sending'`, [
    new Date().toISOString(),
  ])
}

export interface SyncStatusUpdate {
  sync_status?: unknown
  last_sync_at?: unknown
  catalog_valid_until?: unknown
  last_error?: unknown
}

/** A handful of tiny upserts; one transaction keeps them consistent. */
export function updateSyncStatus(status: SyncStatusUpdate) {
  tx(() => {
    if (status.sync_status) setMeta('sync_status', String(status.sync_status))
    if (status.last_sync_at) setMeta('last_sync_at', String(status.last_sync_at))
    if ('catalog_valid_until' in status) {
      setMeta('catalog_valid_until', status.catalog_valid_until ? String(status.catalog_valid_until) : '')
    }
    setMeta('last_error', status.last_error ? String(status.last_error).slice(0, 500) : '')
  })
}

export function syncStatusMeta() {
  return {
    device_id: getMeta('device_id'),
    terminal_name: getMeta('terminal_name'),
    sync_status: getMeta('sync_status') || 'never',
    last_sync_at: getMeta('last_sync_at') || null,
    last_error: getMeta('last_error') || null,
    terminal_sale_sequence: getMeta('terminal_sale_sequence') || '0',
    sync_cursor: getMeta('sync_cursor') || null,
    catalog_valid_until: getMeta('catalog_valid_until') || null,
  }
}
