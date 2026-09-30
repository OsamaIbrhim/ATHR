import { randomUUID } from 'crypto'
import * as os from 'os'
import { catalogNeedsFullRefresh, requireFullCatalogRefresh, snapshotProgress } from './db/catalog'
import { initDb } from './db/connection'
import { requeueInterruptedSends } from './db/outbox'
import { getMeta, setMeta } from './db/queries'
import { highestStoredSaleSequence } from './db/sales'
import { maxTerminalSequence } from './offline-accounting'
import { dbPath } from './paths'
import { alignLocalSequence } from './sale-sequence'
import { readSecureState } from './secure-state'

/** Opens the local database (migrating it) and repairs per-launch state. */
export function openLocalDatabase() {
  initDb(dbPath())

  requeueInterruptedSends()

  if (!getMeta('device_id')) setMeta('device_id', randomUUID())
  if (!getMeta('terminal_name')) setMeta('terminal_name', os.hostname() || 'ATHR POS')
  if (!getMeta('sync_status')) setMeta('sync_status', 'never')
  setMeta(
    'terminal_sale_sequence',
    maxTerminalSequence(getMeta('terminal_sale_sequence'), highestStoredSaleSequence()),
  )
  alignLocalSequence(readSecureState().accounting)

  // A catalog from another protocol must be replaced atomically before it is
  // used for a sale. An interrupted snapshot is kept: the next sync resumes it.
  if (!snapshotProgress() && catalogNeedsFullRefresh()) requireFullCatalogRefresh()
}
