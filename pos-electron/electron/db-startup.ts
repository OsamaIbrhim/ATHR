import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { catalogNeedsFullRefresh, requireFullCatalogRefresh, snapshotProgress } from './db/catalog'
import { initDb } from './db/connection'
import { requeueInterruptedSends } from './db/outbox'
import { getMeta, setMeta } from './db/queries'
import { highestStoredSaleSequence } from './db/sales'
import type { MoneyColumnMigrationReport } from './money-column-migration'
import { maxTerminalSequence } from './offline-accounting'
import { dbPath, moneyMigrationLogPath } from './paths'
import { alignLocalSequence } from './sale-sequence'
import { readSecureState } from './secure-state'

/** Local-only record of the REAL -> minor-units backfill, for support engineers. Never sent to a server. */
function logMoneyMigrationReport(report: MoneyColumnMigrationReport) {
  try {
    fs.mkdirSync(path.dirname(moneyMigrationLogPath()), { recursive: true })
    fs.writeFileSync(
      moneyMigrationLogPath(),
      JSON.stringify(
        {
          version: 1,
          migrated_at: new Date().toISOString(),
          products: report.products,
          sales_local: report.salesLocal,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    )
  } catch {}
  console.log('[ATHR] money-column migration complete', JSON.stringify(report))
}

/** Opens the local database (migrating it) and repairs per-launch state. */
export function openLocalDatabase() {
  initDb(dbPath(), { onMoneyBackfill: logMoneyMigrationReport })

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
