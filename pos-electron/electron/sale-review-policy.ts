export type ReviewableSaleRow = {
  id: string
  payload: string
  local_total?: number | string | null
  local_invoice_number?: string | null
  attempt_count?: number
  last_error?: string | null
}

export type SaleReviewResolution = {
  id: string
  sync_id: string
  status: 'pending' | 'processing' | 'approved' | 'rejected' | 'linked'
  action: 'wait' | 'mark_sent' | 'reverse_local'
  review_reason?: string | null
  resolution_error?: string | null
  invoice?: {
    id: string
    invoice_number: string
    total?: number | string
  } | null
  updated_at?: string
}

export function syncFailureMetadata(message: unknown) {
  const value = String(message || '')
  return {
    code:
      value.match(/(?:^|\s|—|\|)code=([^\s|]+)/)?.[1] ||
      'SYNC_REVIEW_REQUIRED',
    requestId:
      value.match(/(?:^|\s|—|\|)request=([^\s|]+)/)?.[1] ||
      undefined,
  }
}

export function saleReviewSubmission(row: ReviewableSaleRow) {
  let stored: Record<string, any>
  try {
    const parsed = JSON.parse(String(row.payload || ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored sale command is not an object')
    }
    stored = parsed
  } catch {
    throw new Error('Stored sale command is not valid JSON')
  }

  if (String(stored.sync_id || '') !== String(row.id || '')) {
    throw new Error('Stored sale command does not match its outbox sync id')
  }
  if (!Array.isArray(stored.items) || stored.items.length === 0) {
    throw new Error('Stored sale command has no immutable items')
  }

  const localTotal = Number(
    row.local_total ?? stored.local_total ?? 0,
  )
  if (!Number.isFinite(localTotal) || localTotal < 0) {
    throw new Error('Stored sale total is invalid')
  }

  const command = { ...stored, local_total: localTotal }
  const metadata = syncFailureMetadata(row.last_error)
  return {
    command,
    local_invoice_number:
      String(row.local_invoice_number || '').trim() ||
      `LOCAL-${String(row.id).slice(0, 8).toUpperCase()}`,
    local_total: localTotal,
    error_code: metadata.code,
    error_message:
      String(row.last_error || '').trim() ||
      'عملية محلية تحتاج مراجعة إدارية.',
    request_id: metadata.requestId,
    attempt_count: Math.max(0, Number(row.attempt_count || 0)),
  }
}

export function validateSaleReviewResolution(
  value: unknown,
  expectedSyncId: string,
): SaleReviewResolution {
  if (!value || typeof value !== 'object') {
    throw new Error('Sale review response is not an object')
  }
  const result = value as Record<string, any>
  if (!String(result.id || '')) {
    throw new Error('Sale review response is missing its review id')
  }
  if (String(result.sync_id || '') !== expectedSyncId) {
    throw new Error('Sale review response belongs to another sync operation')
  }

  const status = String(result.status || '')
  const action = String(result.action || '')
  const expectedAction =
    status === 'approved' || status === 'linked'
      ? 'mark_sent'
      : status === 'rejected'
        ? 'reverse_local'
        : status === 'pending' || status === 'processing'
          ? 'wait'
          : ''

  if (!expectedAction || action !== expectedAction) {
    throw new Error('Sale review response has an invalid status/action pair')
  }
  if (
    action === 'mark_sent' &&
    (!String(result.invoice?.id || '') ||
      !String(result.invoice?.invoice_number || ''))
  ) {
    throw new Error('Approved sale review is missing the server invoice mapping')
  }

  return result as SaleReviewResolution
}
