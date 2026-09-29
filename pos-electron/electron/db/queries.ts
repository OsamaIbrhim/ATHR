import type Database from 'better-sqlite3'
import { db } from './connection'

type Row = Record<string, any>

/** Prepared statements are compiled once per connection and reused. */
const statementCache = new WeakMap<object, Map<string, Database.Statement>>()

export function stmt(sql: string): Database.Statement {
  const connection = db()
  let cache = statementCache.get(connection)
  if (!cache) {
    cache = new Map()
    statementCache.set(connection, cache)
  }
  let statement = cache.get(sql)
  if (!statement) {
    statement = connection.prepare(sql)
    cache.set(sql, statement)
  }
  return statement
}

// better-sqlite3 rejects `undefined`; the previous engine treated it as NULL.
const bindable = (params: unknown[]) => params.map((value) => (value === undefined ? null : value))

export function q(sql: string, params: unknown[] = []): Row[] {
  return stmt(sql).all(...bindable(params)) as Row[]
}

export function get(sql: string, params: unknown[] = []): Row | undefined {
  return stmt(sql).get(...bindable(params)) as Row | undefined
}

/** Returns the number of rows changed. */
export function run(sql: string, params: unknown[] = []): number {
  return stmt(sql).run(...bindable(params)).changes
}

/** Atomic and durable: BEGIN IMMEDIATE ... COMMIT, ROLLBACK on any throw. */
export function tx<T>(operation: () => T): T {
  return db().transaction(operation).immediate()
}

export function setMeta(key: string, value: string) {
  run(`INSERT OR REPLACE INTO sync_meta (key,value) VALUES (?,?)`, [key, value])
}

export function getMeta(key: string) {
  return String(get(`SELECT value FROM sync_meta WHERE key=?`, [key])?.value || '')
}
