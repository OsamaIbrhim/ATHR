import type Database from 'better-sqlite3'
import {
  migrateMoneyColumnsToMinorUnits,
  type MoneyColumnMigrationDb,
  type MoneyColumnMigrationReport,
} from '../money-column-migration'
import { ADDED_COLUMNS, CREATE_INDEXES, CREATE_TABLES } from './schema'
import { V4_SCHEMA } from './schema-v4'

type Db = Database.Database

export interface MigrationContext {
  /** Called once when the money backfill actually ran (support log). */
  onMoneyBackfill?: (report: MoneyColumnMigrationReport) => void
}

interface Migration {
  version: number
  name: string
  up(db: Db, context: MigrationContext): void
}

function columnNames(db: Db, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((row) => row.name))
}

function moneyMigrationDb(db: Db): MoneyColumnMigrationDb {
  return {
    query: (sql, params = []) => db.prepare(sql).all(...(params as any[])) as any[],
    run: (sql, params = []) => {
      db.prepare(sql).run(...(params as any[]))
    },
    getMeta: (key) =>
      String((db.prepare('SELECT value FROM sync_meta WHERE key=?').get(key) as any)?.value ?? ''),
    setMeta: (key, value) => {
      db.prepare('INSERT OR REPLACE INTO sync_meta (key,value) VALUES (?,?)').run(key, value)
    },
  }
}

/**
 * Ordered, append-only. Each entry runs in its own transaction together with
 * the `user_version` bump, so a failure leaves the previous version intact.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    // Fresh databases get every table; legacy databases (any earlier release,
    // user_version 0) keep their rows and only gain the columns they lack.
    version: 1,
    name: 'baseline-schema',
    up(db) {
      db.exec(CREATE_TABLES)
      const existing = new Map<string, Set<string>>()
      for (const [table, column, definition] of ADDED_COLUMNS) {
        if (!existing.has(table)) existing.set(table, columnNames(db, table))
        if (!existing.get(table)!.has(column)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
        }
      }
    },
  },
  {
    // Non-destructive REAL -> minor-units backfill; the REAL columns stay.
    version: 2,
    name: 'money-minor-units-backfill',
    up(db, context) {
      const report = migrateMoneyColumnsToMinorUnits(moneyMigrationDb(db))
      if (!report.alreadyMigrated) context.onMoneyBackfill?.(report)
    },
  },
  {
    version: 3,
    name: 'hot-path-indexes',
    up(db) {
      db.exec(CREATE_INDEXES)
    },
  },
  {
    version: 4,
    name: 'generic-catalog',
    up(db) {
      db.exec(V4_SCHEMA)
    },
  },
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

export function runMigrations(db: Db, context: MigrationContext = {}): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Local database schema v${current} is newer than this app supports (v${LATEST_SCHEMA_VERSION}). Install the latest ATHR POS.`,
    )
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    try {
      db.transaction(() => {
        migration.up(db, context)
        db.pragma(`user_version = ${migration.version}`)
      }).exclusive()
    } catch (error) {
      throw new Error(
        `Local database migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      )
    }
  }
}
