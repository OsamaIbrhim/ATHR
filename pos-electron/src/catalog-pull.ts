import type { api, PullPosition } from './api'
import type { AthrBridge } from './electron'
import { cursorTransitionIsValid, type CursorTransition } from './sync-cursor'
import type { SyncState } from './types'

type PullBridge = Pick<AthrBridge, 'sync_apply_pull'>
type PullApi = Pick<typeof api, 'pull'>

// A snapshot page holds 1000 variants; this only stops a server that never ends.
const MAX_SYNC_PULL_PAGES = 5_000

export class SyncIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncIntegrityError'
  }
}

/** Where the next request starts: an interrupted snapshot resumes, otherwise a delta or a fresh snapshot. */
function startingPosition(status: SyncState): PullPosition {
  return status.snapshot_cursor && status.snapshot_after
    ? { snapshot_after: status.snapshot_after, snapshot_cursor: status.snapshot_cursor }
    : { cursor: status.sync_cursor || null }
}

/**
 * Checks a page against what was asked for and returns where to ask next.
 * The server's `mode` wins over what we asked: a delta request may come back
 * as a snapshot (a pricing change, or compaction past our cursor), and then
 * the rest of that snapshot is fetched by `snapshot_after`, not by cursor.
 */
function acceptPage(position: PullPosition, response: any): PullPosition {
  const resuming = !!position.snapshot_cursor
  const askedForDelta = !resuming && !!position.cursor
  const hasMore = !!response.has_more
  const cursor =
    response.cursor === undefined || response.cursor === null ? null : String(response.cursor)

  if (response.mode !== 'snapshot' && response.mode !== 'delta') {
    throw new SyncIntegrityError('أوقف POS المزامنة لأن الخادم لم يحدد نوع صفحة الكتالوج.')
  }
  if (response.mode === 'delta' && !askedForDelta) {
    throw new SyncIntegrityError('أوقف POS المزامنة لأن الخادم أعاد تحديثًا جزئيًا بدل نسخة كاملة للكتالوج.')
  }
  const transition: CursorTransition =
    response.mode === 'delta'
      ? { kind: 'delta', hasMore }
      : { kind: resuming ? 'snapshot-next' : 'snapshot-first' }
  const current = resuming ? position.snapshot_cursor! : position.cursor ?? null
  if (!cursorTransitionIsValid(current, cursor, transition)) {
    throw new SyncIntegrityError('أوقف POS المزامنة لأن الخادم أعاد cursor غير صالح أو غير متقدم.')
  }
  if (response.mode === 'snapshot' && !!response.reset_products === resuming) {
    throw new SyncIntegrityError('أوقف POS المزامنة لأن صفحة نسخة الكتالوج لا تتبع الصفحة السابقة.')
  }
  if (!hasMore) return position
  if (response.mode === 'delta') return { cursor }
  const after = String(response.snapshot_after || '')
  if (!after || after === position.snapshot_after) {
    throw new SyncIntegrityError('أوقف POS المزامنة لأن نسخة الكتالوج لا تتقدم.')
  }
  return { snapshot_after: after, snapshot_cursor: cursor! }
}

/**
 * Pulls the catalog until the server says it is complete, applying each page
 * as it arrives. Returns the last page (its cursor is what to store).
 */
export async function pullCatalog(
  branchId: string,
  status: SyncState,
  local: PullBridge,
  client: PullApi,
) {
  let position = startingPosition(status)
  for (let pages = 1; ; pages += 1) {
    const response = await client.pull(branchId, position)
    const next = acceptPage(position, response)

    // A multi-page pull is not safe for checkout until every page is
    // committed. Clearing catalog validity on intermediate pages makes that
    // invariant durable across crashes and process restarts.
    await local.sync_apply_pull({
      ...response,
      catalog_valid_until: response.has_more ? null : response.catalog_valid_until,
    })

    if (!response.has_more) return response
    if (pages >= MAX_SYNC_PULL_PAGES) {
      throw new SyncIntegrityError(
        `أوقف POS المزامنة بعد ${MAX_SYNC_PULL_PAGES} صفحة لحماية الكتالوج من دورة غير منتهية.`,
      )
    }
    position = next
  }
}
