import type Database from 'better-sqlite3'
import { SCHEMA_V1 } from './schema'

type Db = Database.Database

/** Stamped into every ATHR POS database ("ATHR"), so a foreign or pre-release file is recognised. */
export const APPLICATION_ID = 0x41544852

interface Migration {
  version: number
  name: string
  up(db: Db): void
}

/**
 * Ordered, append-only. Each entry runs in its own transaction together with
 * the `user_version` bump, so a failure leaves the previous version intact.
 * Released schemas are never edited: a change is a new entry.
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up(db) {
      db.exec(SCHEMA_V1)
      db.pragma(`application_id = ${APPLICATION_ID}`)
    },
  },
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

function hasAnyTable(db: Db): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1`).get()
}

export function runMigrations(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const ours = db.pragma('application_id', { simple: true }) === APPLICATION_ID

  // A file with data that this app did not create (a pre-release dev build, or
  // not a POS database at all) is never migrated or touched.
  if (!ours && (current > 0 || hasAnyTable(db))) {
    throw new Error(
      'This local database was created by a pre-release ATHR POS build and cannot be upgraded. ' +
        'Close the app, delete the local data folder named below, and start again.',
    )
  }
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Local database schema v${current} is newer than this app supports (v${LATEST_SCHEMA_VERSION}). Install the latest ATHR POS.`,
    )
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    try {
      db.transaction(() => {
        migration.up(db)
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
