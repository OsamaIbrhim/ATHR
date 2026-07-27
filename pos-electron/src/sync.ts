import { api, ApiError } from './api'
import { bold, BoldBridge } from './electron'
import { SyncState } from './types'
import {
  assertPosCompatibility,
  PosCompatibilityError,
} from './pos-compatibility'
import {
  classifySyncError,
  formatSyncError,
  outboxItemDueAt,
} from './sync-policy'

type SyncBridge = Pick<
  BoldBridge,
  | 'sync_get_status'
  | 'sync_set_status'
  | 'sync_get_outbox'
  | 'sync_mark_sending'
  | 'sync_mark_sent'
  | 'sync_mark_failed'
  | 'sync_apply_pull'
>

type SyncApi = Pick<
  typeof api,
  'sale' | 'pull' | 'heartbeat' | 'compatibility'
>

let activeSync: Promise<SyncState> | null = null
let consecutiveSyncFailures = 0
const MAX_SYNC_PULL_PAGES = 100
const SUCCESS_SYNC_INTERVAL_MS = 15_000

export class SyncIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncIntegrityError'
  }
}

function cursorTransitionIsValid(
  current: string | null,
  next: string | null,
  hasMore: boolean,
) {
  if (next === null) return false
  try {
    const nextValue = BigInt(next)
    if (nextValue < 0n) return false
    if (current === null) return !hasMore
    const currentValue = BigInt(current)
    return hasMore
      ? nextValue > currentValue
      : nextValue >= currentValue
  } catch {
    return false
  }
}

export function isRetryableSyncError(error: unknown) {
  return classifySyncError(error).retryable
}

function syncStatusForFailure(
  decision: ReturnType<typeof classifySyncError>,
) {
  // A reachable backend returning 4xx/5xx is not an offline device.
  return decision.failureClass === 'network' ? 'offline' : 'error'
}

function serverDocument(result: any) {
  return {
    server_document_id: result?.id || null,
    server_document_number: result?.invoice_number || null,
  }
}

async function publishHeartbeat(
  client: SyncApi,
  state: SyncState,
) {
  return client.heartbeat({
    device_id: state.device_id,
    name: state.terminal_name,
    app_version: state.app_version,
    sync_status: state.sync_status,
    last_sync_at:
      state.last_sync_at || undefined,
    last_error:
      state.last_error || undefined,
    pending_count: state.pending_count,
  })
}

function compatibilityFailure(error: unknown) {
  if (error instanceof ApiError && error.status === 404) {
    return new PosCompatibilityError(
      'POS_BACKEND_TOO_OLD',
      'نسخة الخادم أقدم من عقد التوافق المطلوب بواسطة نقطة البيع. تم إيقاف المزامنة حتى تحديث الخادم.',
    )
  }
  return error
}

export async function performSync(
  branchId: string,
  local: SyncBridge,
  client: SyncApi,
  options: { force?: boolean } = {},
): Promise<SyncState> {
  let state = await local.sync_get_status()

  let compatibilityPayload: unknown
  try {
    compatibilityPayload = await client.compatibility()
  } catch (error) {
    throw compatibilityFailure(error)
  }

  const compatible = assertPosCompatibility(
    compatibilityPayload,
    state.app_version,
  )

  await local.sync_set_status({
    sync_status: 'syncing',
    last_error: null,
  })

  state = {
    ...state,
    sync_status: 'syncing',
    last_error: null,
    next_sync_at: null,
    blocked_reason: null,
    backend_version: compatible.backendVersion,
    backend_deployment_sha: compatible.deploymentSha,
    api_protocol: compatible.protocol,
  }

  await publishHeartbeat(client, state)

  const outbox = await local.sync_get_outbox()
  const nowMs = Date.now()
  const dueOutbox = outbox.filter(
    (item) =>
      options.force ||
      outboxItemDueAt(item, nowMs) <= nowMs,
  )

  if (outbox.length > 0 && dueOutbox.length === 0) {
    const nextAttempt = Math.min(
      ...outbox.map((item) => outboxItemDueAt(item, nowMs)),
    )
    const waiting: SyncState = {
      ...state,
      sync_status: 'error',
      last_error:
        'المزامنة مؤجلة تلقائيًا بعد فشل مؤقت لحماية الخادم من تكرار الطلبات.',
      pending_count: outbox.length,
      next_sync_at: new Date(nextAttempt).toISOString(),
      blocked_reason: null,
    }
    await local.sync_set_status(waiting)
    await publishHeartbeat(client, waiting).catch(() => undefined)
    return waiting
  }

  for (const item of dueOutbox) {
    try {
      await local.sync_mark_sending(item.id)
      const stored = JSON.parse(item.payload)

      // إزالة الحقول المحلية التي لا يقبلها Backend DTO
      const payload = {
        ...stored,
        local_total: Number(item.local_total ?? stored.local_total ?? 0),
      }

      const result = await client.sale(payload)
      await local.sync_mark_sent({
        id: item.id,
        ...serverDocument(result),
      })
    } catch (error) {
      const decision = classifySyncError(
        error,
        Number(item.attempt_count || 0) + 1,
        Date.now(),
        String(item.id),
      )
      const message = formatSyncError(error)

      await local.sync_mark_failed({
        id: item.id,
        error: message,
        retryable: decision.retryable,
      }).catch(() => undefined)

      const current =
        await local.sync_get_status()

      const failed: SyncState = {
        ...state,
        sync_status: syncStatusForFailure(decision),
        last_error: decision.retryable
          ? message
          : `عملية مرفوضة وتحتاج مراجعة: ${message}`,
        pending_count: current.pending_count,
        next_sync_at: decision.nextAttemptAt,
        blocked_reason: decision.blockedReason,
      }

      await local.sync_set_status(failed)

      await publishHeartbeat(
        client,
        failed,
      ).catch(() => undefined)

      return failed
    }
  }

  // قد يضيف الكاشير عملية بيع جديدة أثناء المزامنة، أو قد تبقى عملية
  // أخرى مؤجلة بسبب backoff سابق. لا نسحب مخزونًا جديدًا قبل حسمها.
  const remaining =
    await local.sync_get_outbox()

  if (remaining.length) {
    const remainingNow = Date.now()
    const nextAttempt = Math.min(
      ...remaining.map((item) => outboxItemDueAt(item, remainingNow)),
    )
    const pending: SyncState = {
      ...state,
      sync_status: 'error',
      last_error:
        'توجد عملية محلية أخرى في انتظار موعد إعادة المحاولة قبل تحديث المخزون.',
      pending_count: remaining.length,
      next_sync_at: new Date(
        Math.max(remainingNow + 1_000, nextAttempt),
      ).toISOString(),
      blocked_reason: null,
    }

    await local.sync_set_status(pending)

    await publishHeartbeat(
      client,
      pending,
    ).catch(() => undefined)

    return pending
  }

  const unresolved = await local.sync_get_status()
  if (unresolved.pending_count > 0) {
    const failed: SyncState = {
      ...state,
      sync_status: 'error',
      last_error: 'توجد عمليات فاشلة تحتاج مراجعة قبل اكتمال المزامنة.',
      pending_count: unresolved.pending_count,
      next_sync_at: null,
      blocked_reason: 'OUTBOX_REVIEW_REQUIRED',
    }
    await local.sync_set_status(failed)
    await publishHeartbeat(client, failed).catch(() => undefined)
    return failed
  }

  let cursor = state.sync_cursor || null
  let response: any
  let pages = 0

  while (true) {
    response = await client.pull(
      branchId,
      cursor,
    )

    const nextCursor =
      response.cursor === undefined ||
      response.cursor === null
        ? cursor
        : String(response.cursor)

    if (
      !cursorTransitionIsValid(
        cursor,
        nextCursor,
        !!response.has_more,
      )
    ) {
      throw new SyncIntegrityError(
        'أوقف POS المزامنة لأن الخادم أعاد cursor غير صالح أو غير متقدم.',
      )
    }

    // A multi-page delta is not safe for checkout until every page is
    // committed. Clearing catalog validity on intermediate pages makes that
    // invariant durable across crashes and process restarts.
    await local.sync_apply_pull({
      ...response,
      catalog_valid_until:
        response.has_more
          ? null
          : response.catalog_valid_until,
    })

    cursor = nextCursor
    pages += 1
    if (!response.has_more) break
    if (pages >= MAX_SYNC_PULL_PAGES) {
      throw new SyncIntegrityError(
        `أوقف POS المزامنة بعد ${MAX_SYNC_PULL_PAGES} صفحة لحماية الكتالوج من دورة غير منتهية.`,
      )
    }
  }

  const completed: SyncState = {
    ...state,
    sync_status: 'success',
    last_sync_at:
      response.server_time ||
      new Date().toISOString(),
    last_error: null,
    pending_count: 0,
    next_sync_at: null,
    blocked_reason: null,
    sync_cursor: cursor,
    catalog_valid_until: response.catalog_valid_until || state.catalog_valid_until || null,
  }

  await local.sync_set_status(completed)
  await publishHeartbeat(client, completed)

  return completed
}

export function syncLoop(
  branchId: string,
  onStatus?: (state: SyncState) => void,
  options: { force?: boolean } = {},
): Promise<SyncState> {
  if (activeSync) {
    return activeSync
  }

  activeSync = performSync(
    branchId,
    bold,
    api,
    options,
  )
    .catch(async error => {
      const previous =
        await bold.sync_get_status()

      consecutiveSyncFailures += 1
      const decision = classifySyncError(
        error,
        consecutiveSyncFailures,
      )
      const failed: SyncState = {
        ...previous,
        sync_status: syncStatusForFailure(decision),
        last_error: formatSyncError(error),
        next_sync_at: decision.nextAttemptAt,
        blocked_reason: decision.blockedReason,
      }

      await bold.sync_set_status(failed)

      return failed
    })
    .then(state => {
      if (state.sync_status === 'success') {
        consecutiveSyncFailures = 0
      }
      onStatus?.(state)
      return state
    })
    .finally(() => {
      activeSync = null
    })

  return activeSync
}

export function startSync(
  branchId: string,
  onStatus?: (state: SyncState) => void,
) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = (state: SyncState) => {
    if (stopped) return
    if (timer) clearTimeout(timer)

    if (state.blocked_reason && !state.next_sync_at) {
      timer = null
      return
    }

    const target = Date.parse(String(state.next_sync_at || ''))
    const delay = Number.isFinite(target)
      ? Math.max(1_000, target - Date.now())
      : SUCCESS_SYNC_INTERVAL_MS

    timer = setTimeout(() => {
      void run(false)
    }, delay)
  }

  const run = async (force: boolean) => {
    if (stopped) return
    const state = await syncLoop(
      branchId,
      onStatus,
      { force },
    )
    schedule(state)
  }

  bold.sync_get_status()
    .then((state) => {
      onStatus?.(state)
      void run(false)
    })
    .catch(() => void run(false))

  const online = () => {
    void run(false)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener(
      'online',
      online,
    )
  }

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)

    if (typeof window !== 'undefined') {
      window.removeEventListener(
        'online',
        online,
      )
    }
  }
}
