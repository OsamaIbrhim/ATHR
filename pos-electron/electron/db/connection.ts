import Database from 'better-sqlite3'
import { runMigrations } from './migrations'

export type Db = Database.Database

/**
 * Opens (creating if needed) the local database, applies the connection
 * pragmas and runs pending migrations. Pure Node: no Electron imports, so the
 * tests exercise exactly this code.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file)
  try {
    // WAL makes every commit an append to the -wal file instead of a whole-file rewrite.
    if (String(db.pragma('journal_mode = WAL', { simple: true })).toLowerCase() !== 'wal') {
      throw new Error('Could not enable WAL journaling for the local database')
    }
    // synchronous=NORMAL: in WAL mode a committed transaction survives an
    // application or Electron crash (the WAL is written before commit returns);
    // only an OS crash or power loss can lose the last few commits, and it can
    // never corrupt the file. FULL would add an fsync per sale for a guarantee
    // the outbox plus the server's idempotent sale creation already cover.
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    db.pragma('journal_size_limit = 67108864')
    runMigrations(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

let current: Db | null = null

export function initDb(file: string): Db {
  closeDb()
  current = openDatabase(file)
  return current
}

export function db(): Db {
  if (!current) throw new Error('Local database is not open')
  return current
}

/** Closing checkpoints the WAL, so the main file is complete afterwards. */
export function closeDb() {
  if (!current) return
  const closing = current
  current = null
  closing.close()
}
