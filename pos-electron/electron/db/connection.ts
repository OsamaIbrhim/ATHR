import Database from 'better-sqlite3'
import * as fs from 'fs'
import { runMigrations, type MigrationContext } from './migrations'

export type Db = Database.Database

export const PRE_ENGINE_BACKUP_SUFFIX = '.pre-w4a.bak'

/**
 * A file whose header says "rollback journal" (bytes 18/19 == 1) was last
 * written by sql.js (or another non-WAL engine), i.e. this is the first open
 * with better-sqlite3. Keep one full copy of it before we touch it. The app
 * never deletes that copy (except as part of a confirmed factory reset).
 */
function backupBeforeFirstOpen(file: string) {
  const backup = `${file}${PRE_ENGINE_BACKUP_SUFFIX}`
  if (!fs.existsSync(file) || fs.existsSync(backup)) return
  const header = Buffer.alloc(20)
  const fd = fs.openSync(file, 'r')
  let bytesRead = 0
  try {
    bytesRead = fs.readSync(fd, header, 0, 20, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (bytesRead < 20 || header[18] !== 1 || header[19] !== 1) return
  const temporary = `${backup}.tmp`
  fs.copyFileSync(file, temporary)
  if (fs.statSync(temporary).size !== fs.statSync(file).size) {
    fs.rmSync(temporary, { force: true })
    throw new Error('Pre-migration backup of the local database failed verification')
  }
  fs.renameSync(temporary, backup)
}

/**
 * Opens (creating if needed) the local database, applies the connection
 * pragmas and runs pending migrations. Pure Node: no Electron imports, so the
 * tests exercise exactly this code.
 */
export function openDatabase(file: string, context: MigrationContext = {}): Db {
  backupBeforeFirstOpen(file)
  const db = new Database(file)
  try {
    // WAL converts a legacy rollback-journal file on first open and makes every
    // commit an append to the -wal file instead of a whole-file rewrite.
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
    runMigrations(db, context)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

let current: Db | null = null

export function initDb(file: string, context: MigrationContext = {}): Db {
  closeDb()
  current = openDatabase(file, context)
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
