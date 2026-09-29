import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, initDb, openDatabase, PRE_ENGINE_BACKUP_SUFFIX } from './connection'
import { LATEST_SCHEMA_VERSION } from './migrations'
import { searchProducts, EXACT_MATCH_QUERY } from './catalog'
import { markSending, updateSyncStatus, markFailed } from './outbox'
import { get, getMeta, q, run, setMeta } from './queries'
import { commitLocalSale, type LocalSaleRecord } from './sales'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athr-db-'))
  file = path.join(dir, 'athr_pos.sqlite')
})

afterEach(() => {
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort()

const TABLES = ['products', 'stock', 'sellers', 'outbox', 'sales_local', 'held_sales', 'sync_meta']

/** The very first release schema: no tax, Arabic name, sale context or sync columns. */
const LEGACY_V0 = `
  CREATE TABLE products (id TEXT PRIMARY KEY, sku TEXT, name_en TEXT, barcode_ean13 TEXT,
    barcode_internal TEXT, size TEXT, color TEXT, cost_price REAL, selling_price REAL);
  CREATE TABLE stock (variant_id TEXT PRIMARY KEY, qty INTEGER);
  CREATE TABLE sellers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE outbox (id TEXT PRIMARY KEY, type TEXT, payload TEXT,
    sync_status TEXT DEFAULT 'pending', created_at TEXT);
  CREATE TABLE sales_local (sync_id TEXT PRIMARY KEY, invoice_number TEXT, total REAL, created_at TEXT);
  CREATE TABLE held_sales (id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, cashier_id TEXT NOT NULL,
    shift_id TEXT NOT NULL, customer_json TEXT, items_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO products VALUES ('p1','SKU-1','Shirt','6221234567890','ATHR-1','M','Blue',10.5,19.99);
  INSERT INTO stock VALUES ('p1', 7);
  INSERT INTO sellers VALUES ('s1','Seller One');
  INSERT INTO outbox (id,type,payload,sync_status,created_at) VALUES ('o1','sale','{}','pending','2024-01-01');
  INSERT INTO sales_local VALUES ('o1','LOCAL-1',19.99,'2024-01-01');
  INSERT INTO held_sales VALUES ('h1','b1','c1','sh1',NULL,'[]','2024-01-01','2024-01-01');
  INSERT INTO sync_meta VALUES ('sync_cursor','42');
`

/** Written exactly like sql.js: rollback journal, never WAL. */
function createLegacyDatabase(sql: string) {
  const legacy = new Database(file)
  legacy.pragma('journal_mode = DELETE')
  legacy.exec(sql)
  legacy.close()
}

describe('migrations', () => {
  it('builds the full schema, indexes and WAL on a fresh database', () => {
    const db = openDatabase(file)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as any[]).map(
      (row) => row.name,
    )
    expect(indexes).toEqual(
      expect.arrayContaining([
        'products_barcode_ean13_idx',
        'products_barcode_internal_idx',
        'products_sku_idx',
        'outbox_status_created_idx',
        'sales_local_occurred_idx',
        'held_sales_scope_created_idx',
      ]),
    )
    expect(fs.existsSync(`${file}${PRE_ENGINE_BACKUP_SUFFIX}`)).toBe(false)
    db.close()
  })

  it('reopening an up to date database is a no-op', () => {
    openDatabase(file).close()
    const db = openDatabase(file)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    db.close()
  })

  it('upgrades a legacy sql.js-era database, keeps every row and backs it up first', () => {
    createLegacyDatabase(LEGACY_V0)
    const before = fs.readFileSync(file)

    const db = openDatabase(file)

    // One-time byte-identical backup of the pre-engine file.
    expect(fs.readFileSync(`${file}${PRE_ENGINE_BACKUP_SUFFIX}`).equals(before)).toBe(true)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')

    // Same schema as a fresh database.
    const fresh = openDatabase(path.join(dir, 'fresh.sqlite'))
    for (const table of TABLES) expect(columns(db, table)).toEqual(columns(fresh, table))
    fresh.close()

    // Every legacy row survived.
    expect(db.prepare('SELECT * FROM products').get()).toMatchObject({
      id: 'p1', sku: 'SKU-1', name_en: 'Shirt', selling_price: 19.99, catalog_version: 2,
      selling_price_minor_units: 1999, cost_price_minor_units: 1050,
    })
    expect(db.prepare('SELECT qty FROM stock').get()).toEqual({ qty: 7 })
    expect(db.prepare('SELECT name FROM sellers').get()).toEqual({ name: 'Seller One' })
    expect(db.prepare('SELECT * FROM outbox').get()).toMatchObject({ id: 'o1', sync_status: 'pending', attempt_count: 0 })
    expect(db.prepare('SELECT * FROM sales_local').get()).toMatchObject({
      sync_id: 'o1', total: 19.99, total_minor_units: 1999,
    })
    expect(db.prepare('SELECT id FROM held_sales').get()).toEqual({ id: 'h1' })
    expect(db.prepare(`SELECT value FROM sync_meta WHERE key='sync_cursor'`).get()).toEqual({ value: '42' })
    db.close()

    // The backup is never recreated or overwritten by later launches.
    openDatabase(file).close()
    expect(fs.readFileSync(`${file}${PRE_ENGINE_BACKUP_SUFFIX}`).equals(before)).toBe(true)
  })

  it('upgrades a database that already had every ALTER except the money columns', () => {
    createLegacyDatabase(`
      CREATE TABLE products (id TEXT PRIMARY KEY, sku TEXT, name_en TEXT, name_ar TEXT, barcode_ean13 TEXT,
        barcode_internal TEXT, size TEXT, color TEXT, cost_price REAL, selling_price REAL,
        unit_tax REAL DEFAULT 0, catalog_version INTEGER NOT NULL DEFAULT 2);
      INSERT INTO products (id,sku,name_ar,cost_price,selling_price,unit_tax) VALUES ('p1','A','قميص',1,2.5,0.35);
    `)
    const db = openDatabase(file)
    expect(db.prepare('SELECT selling_price_minor_units s, unit_tax_minor_units t FROM products').get()).toEqual({
      s: 250, t: 35,
    })
    db.close()
  })

  it('fails loudly and rolls back only the failing migration on a broken legacy schema', () => {
    createLegacyDatabase(`
      CREATE TABLE held_sales (id TEXT PRIMARY KEY, items_json TEXT);
      INSERT INTO held_sales VALUES ('h1','[]');
    `)
    // held_sales lacks branch_id, so the index migration (3) cannot succeed.
    expect(() => openDatabase(file)).toThrow(/migration 3 \(hot-path-indexes\) failed: no such column/)
    const raw = new Database(file)
    expect(raw.pragma('user_version', { simple: true })).toBe(2)
    expect(raw.prepare('SELECT id FROM held_sales').all()).toEqual([{ id: 'h1' }])
    expect(raw.prepare(`SELECT name FROM sqlite_master WHERE name='products_sku_idx'`).get()).toBeUndefined()
    raw.close()
  })

  it('refuses a database written by a newer app', () => {
    createLegacyDatabase(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1};`)
    expect(() => openDatabase(file)).toThrow(/newer than this app supports/)
  })
})

function saleRecord(overrides: Partial<LocalSaleRecord> = {}): LocalSaleRecord {
  return {
    syncId: 'sale-1',
    invoiceNumber: 'LOCAL-T1-000001',
    localTotal: 30,
    occurredAt: '2025-01-01T10:00:00.000Z',
    paymentMethod: 'cash',
    customerPhone: null,
    cashierId: 'cashier-1',
    sellerId: 'seller-1',
    shiftId: 'shift-1',
    offlineSessionId: 'session-1',
    terminalSequence: '000001',
    items: [
      { variant_id: 'a', qty: 2 },
      { variant_id: 'b', qty: 1 },
    ],
    outboxPayload: '{"sync_id":"sale-1"}',
    ...overrides,
  }
}

function seedCatalog() {
  run(`INSERT INTO stock (variant_id,qty) VALUES ('a',5),('b',1)`)
  setMeta('terminal_sale_sequence', '000000')
}

const snapshot = () => ({
  stock: q(`SELECT * FROM stock ORDER BY variant_id`),
  sales: q(`SELECT * FROM sales_local`),
  outbox: q(`SELECT * FROM outbox`),
  sequence: getMeta('terminal_sale_sequence'),
})

describe('sale commit', () => {
  beforeEach(() => {
    initDb(file)
    seedCatalog()
  })

  it('writes stock, sale, outbox and sequence together', () => {
    commitLocalSale(saleRecord())
    expect(q(`SELECT variant_id,qty FROM stock ORDER BY variant_id`)).toEqual([
      { variant_id: 'a', qty: 3 },
      { variant_id: 'b', qty: 0 },
    ])
    expect(get(`SELECT total_minor_units FROM sales_local WHERE sync_id='sale-1'`)).toEqual({ total_minor_units: 3000 })
    expect(get(`SELECT sync_status FROM outbox WHERE id='sale-1'`)).toEqual({ sync_status: 'pending' })
    expect(getMeta('terminal_sale_sequence')).toBe('000001')
  })

  it('writes nothing when a later line lacks stock', () => {
    const before = snapshot()
    expect(() =>
      commitLocalSale(saleRecord({ items: [{ variant_id: 'a', qty: 2 }, { variant_id: 'b', qty: 9 }] })),
    ).toThrow(/Insufficient local stock for b/)
    expect(snapshot()).toEqual(before)
  })

  it('rolls back the stock update when a later insert fails mid-transaction', () => {
    commitLocalSale(saleRecord({ items: [{ variant_id: 'a', qty: 1 }] }))
    const before = snapshot()
    // Same sync id again: stock is decremented first, then the sales_local insert violates the PK.
    expect(() => commitLocalSale(saleRecord({ items: [{ variant_id: 'a', qty: 1 }], terminalSequence: '000002' }))).toThrow(
      /UNIQUE/,
    )
    expect(snapshot()).toEqual(before)
  })
})

describe('product search', () => {
  beforeEach(() => {
    initDb(file)
    for (let i = 0; i < 60; i += 1) {
      run(
        `INSERT INTO products (id,sku,name_en,name_ar,barcode_ean13,barcode_internal,selling_price_minor_units)
         VALUES (?,?,?,?,?,?,1000)`,
        [`id-${i}`, `SKU-${String(i).padStart(3, '0')}`, `Polo ${i}`, `بولو ${i}`, `62200000${String(i).padStart(5, '0')}`, `ATHR-${i}`],
      )
    }
    run(`INSERT INTO stock (variant_id,qty) VALUES ('id-7',4)`)
  })

  it('uses an index for the exact barcode / sku match', () => {
    const details = q(`EXPLAIN QUERY PLAN ${EXACT_MATCH_QUERY.replaceAll('?', "'x'")}`)
      .map((row) => row.detail)
      .join('\n')
    expect(details).toContain('USING INDEX')
    expect(details).not.toMatch(/SCAN p\b/)
  })

  it('returns only the exact hit (with stock) when a barcode or sku matches', () => {
    expect(searchProducts('6220000000007')).toMatchObject([{ id: 'id-7', qty: 4 }])
    expect(searchProducts('ATHR-7')).toHaveLength(1)
    expect(searchProducts('SKU-007')).toHaveLength(1)
  })

  it('falls back to a limited text search and ignores empty input', () => {
    expect(searchProducts('Polo 1').map((row) => row.id)).toContain('id-1')
    expect(searchProducts('SKU')).toHaveLength(50)
    expect(searchProducts('بولو 3').length).toBeGreaterThan(0)
    expect(searchProducts('   ')).toEqual([])
    expect(searchProducts('nomatch-xyz')).toEqual([])
  })
})

describe('sync status updates', () => {
  it('only append tiny WAL frames and leave the main file and other rows alone', () => {
    const db = initDb(file)
    const insert = db.prepare(`INSERT INTO products (id,sku,name_en,name_ar) VALUES (?,?,?,?)`)
    db.transaction(() => {
      for (let i = 0; i < 20_000; i += 1) insert.run(`id-${i}`, `SKU-${i}`, `Product ${i}`, `منتج ${i}`)
    })()
    run(`INSERT INTO outbox (id,type,payload,sync_status,created_at) VALUES ('o1','sale','{}','pending','t')`)
    db.pragma('wal_checkpoint(TRUNCATE)')

    const mainBefore = fs.readFileSync(file)
    const productsBefore = q(`SELECT * FROM products`)
    const changesBefore = db.prepare('SELECT total_changes() AS n').get() as { n: number }
    const walFile = `${file}-wal`

    markSending('o1')
    markFailed('o1', 'boom', true)
    updateSyncStatus({ sync_status: 'idle', last_sync_at: '2025-01-01T00:00:00Z', last_error: 'x' })

    const changesAfter = db.prepare('SELECT total_changes() AS n').get() as { n: number }
    expect(changesAfter.n - changesBefore.n).toBeLessThan(10)
    expect(fs.readFileSync(file).equals(mainBefore)).toBe(true)
    expect(fs.statSync(walFile).size).toBeLessThan(128 * 1024)
    expect(q(`SELECT * FROM products`)).toEqual(productsBefore)
    expect(get(`SELECT sync_status,attempt_count,last_error FROM outbox WHERE id='o1'`)).toEqual({
      sync_status: 'pending', attempt_count: 1, last_error: 'boom',
    })
    expect(getMeta('sync_status')).toBe('idle')
  })
})
