import { ApiError } from './api'
import { PosCompatibilityError } from './pos-compatibility'

export type SyncFailureClass =
  | 'network'
  | 'rate_limit'
  | 'server'
  | 'authentication'
  | 'terminal'
  | 'compatibility'
  | 'validation'
  | 'integrity'
  | 'unknown'

export type SyncFailureDecision = {
  retryable: boolean
  failureClass: SyncFailureClass
  nextAttemptAt: string | null
  blockedReason: string | null
}

const RETRY_DELAYS_MS = [
  15_000,
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
]

const TERMINAL_CODES = new Set([
  'TERMINAL_REVOKED',
  'TERMINAL_NOT_ENROLLED',
  'TERMINAL_CREDENTIAL_INVALID',
])

const AUTH_CODES = new Set([
  'TOKEN_EXPIRED',
  'AUTH_EXPIRED',
  'UNAUTHORIZED',
])

export function retryDelayMs(attempt: number, retryAfterMs?: number) {
  if (Number.isFinite(retryAfterMs) && Number(retryAfterMs) > 0) {
    return Math.min(15 * 60_000, Math.max(1_000, Number(retryAfterMs)))
  }
  const index = Math.min(
    RETRY_DELAYS_MS.length - 1,
    Math.max(0, Math.trunc(attempt) - 1),
  )
  return RETRY_DELAYS_MS[index]
}

export function stableRetryJitterMs(
  id: string,
  attempt: number,
  delayMs: number,
) {
  if (!id) return 0
  let hash = 2166136261
  const value = `${id}:${attempt}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const windowMs = Math.max(1, Math.floor(delayMs * 0.2))
  return (hash >>> 0) % windowMs
}

function retry(
  failureClass: SyncFailureClass,
  attempt: number,
  nowMs: number,
  retryAfterMs?: number,
  operationId = '',
): SyncFailureDecision {
  const delay = retryDelayMs(attempt, retryAfterMs)
  return {
    retryable: true,
    failureClass,
    nextAttemptAt: new Date(
      nowMs + delay + stableRetryJitterMs(operationId, attempt, delay),
    ).toISOString(),
    blockedReason: null,
  }
}

function block(
  failureClass: SyncFailureClass,
  reason: string,
): SyncFailureDecision {
  return {
    retryable: false,
    failureClass,
    nextAttemptAt: null,
    blockedReason: reason,
  }
}

export function classifySyncError(
  error: unknown,
  attempt = 1,
  nowMs = Date.now(),
  operationId = '',
): SyncFailureDecision {
  if (error instanceof PosCompatibilityError) {
    return block('compatibility', error.code)
  }
  if (
    error instanceof SyntaxError ||
    (error as Error)?.name === 'SyncIntegrityError'
  ) {
    return block('integrity', 'SYNC_RESPONSE_QUARANTINED')
  }
  if (!(error instanceof ApiError)) {
    return block('unknown', 'SYNC_UNKNOWN_ERROR_REVIEW_REQUIRED')
  }
  if (error.code === 'NETWORK_ERROR' || error.status === 408) {
    return retry('network', attempt, nowMs, undefined, operationId)
  }
  if (error.status === 429) {
    return retry('rate_limit', attempt, nowMs, error.retryAfterMs, operationId)
  }
  if (error.status && error.status >= 500) {
    // A server outage must never convert a committed local sale into a
    // permanent failure. Retry with bounded backoff until the service returns.
    return retry('server', attempt, nowMs, error.retryAfterMs, operationId)
  }
  if (TERMINAL_CODES.has(error.code)) {
    return block('terminal', error.code)
  }
  if (AUTH_CODES.has(error.code) || error.status === 401) {
    return block('authentication', error.code)
  }
  if ([403, 409, 422, 426].includes(Number(error.status))) {
    return block('validation', error.code)
  }
  return block('unknown', error.code || 'SYNC_OPERATION_QUARANTINED')
}

export function outboxItemDueAt(
  item: {
    id?: string
    attempt_count?: number
    last_attempt_at?: string | null
  },
  nowMs = Date.now(),
) {
  const lastAttempt = Date.parse(String(item.last_attempt_at || ''))
  const attempt = Number(item.attempt_count || 0)
  if (!Number.isFinite(lastAttempt) || attempt <= 0) return nowMs
  const delay = retryDelayMs(attempt)
  return lastAttempt + delay + stableRetryJitterMs(
    String(item.id || ''),
    attempt,
    delay,
  )
}

export function formatSyncError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : String(error || 'Unknown synchronization error')

  if (error instanceof ApiError) {
    const values = [
      error.code ? `code=${error.code}` : '',
      error.status ? `http=${error.status}` : '',
      error.requestId ? `request=${error.requestId}` : '',
    ].filter(Boolean)
    return values.length ? `${message} — ${values.join(' | ')}` : message
  }

  if (error instanceof PosCompatibilityError) {
    return `${message} — code=${error.code}`
  }

  return message
}
