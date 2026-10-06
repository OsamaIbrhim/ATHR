import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, initDb, openDatabase } from './connection'
import { APPLICATION_ID, LATEST_SCHEMA_VERSION } from './migrations'
import { markSending, updateSyncStatus, markFailed } from './outbox'
import { get, getMeta, q, run, setMeta } from './queries'
import { assertQuantityPrecision, commitLocalSale, type LocalSaleRecord } from './sales'

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
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

const TABLES = ['products', 'stock', 'barcodes', 'sellers', 'outbox', 'sales_local', 'held_sales', 'sync_meta']

/** A file written by a pre-release dev build: no ATHR application id, whatever its user_version. */
function createDevDatabase(sql: string) {
  const dev = new Database(file)
  dev.exec(sql)
  dev.close()
}

describe('migrations', () => {
  it('builds the full schema, indexes and WAL on a fresh database', () => {
    const db = openDatabase(file)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(LATEST_SCHEMA_VERSION).toBe(2)
    expect(db.pragma('application_id', { simple: true })).toBe(APPLICATION_ID)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[]).map((row) => row.name)
    expect(tables.sort()).toEqual([...TABLES].sort())
    const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as any[]).map(
      (row) => row.name,
    )
    expect(indexes).toEqual(
      expect.arrayContaining([
        'products_sku_idx',
        'barcodes_variant_idx',
        'outbox_status_created_idx',
        'sales_local_occurred_idx',
        'held_sales_scope_created_idx',
      ]),
    )
    db.close()
  })

  it('stores money only as integer minor units and has no size/color columns', () => {
    const db = openDatabase(file)
    expect(columns(db, 'products')).toEqual(
      expect.arrayContaining(['selling_price_minor_units', 'unit_tax_minor_units', 'label', 'attributes']),
    )
    for (const table of TABLES) {
      for (const column of columns(db, table)) {
        expect(column).not.toMatch(/^(size|color|cost_price|selling_price|unit_tax|total)$/)
      }
    }
    db.close()
  })

  it('reopening an up to date database is a no-op', () => {
    openDatabase(file).close()
    const db = openDatabase(file)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    db.close()
  })

  it.each([1, 2, 3, 4])('refuses a pre-release dev database at user_version %i and leaves it untouched', (version) => {
    createDevDatabase(`
      CREATE TABLE outbox (id TEXT PRIMARY KEY, payload TEXT);
      INSERT INTO outbox VALUES ('o1','{}');
      PRAGMA user_version = ${version};
    `)
    expect(() => openDatabase(file)).toThrow(/pre-release ATHR POS build/)
    const raw = new Database(file)
    expect(raw.pragma('user_version', { simple: true })).toBe(version)
    expect(raw.prepare('SELECT id FROM outbox').all()).toEqual([{ id: 'o1' }])
    raw.close()
  })

  it('refuses the oldest unversioned dev database (tables, user_version 0)', () => {
    createDevDatabase('CREATE TABLE sales_local (sync_id TEXT PRIMARY KEY, total REAL);')
    expect(() => openDatabase(file)).toThrow(/pre-release ATHR POS build/)
  })

  it('refuses a database written by a newer app', () => {
    openDatabase(file).close()
    const raw = new Database(file)
    raw.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    raw.close()
    expect(() => openDatabase(file)).toThrow(/newer than this app supports/)
  })

  it('barcode codes are unique: one code belongs to one variant', () => {
    const db = openDatabase(file)
    db.prepare(`INSERT INTO barcodes (code,variant_id,pack_qty,kind) VALUES ('c','a',1,'standard')`).run()
    expect(() =>
      db.prepare(`INSERT INTO barcodes (code,variant_id,pack_qty,kind) VALUES ('c','b',1,'standard')`).run(),
    ).toThrow(/UNIQUE/)
    db.close()
  })

  it('stock holds decimal quantities', () => {
    const db = openDatabase(file)
    db.prepare(`INSERT INTO stock (variant_id,qty) VALUES ('p1',1.235)`).run()
    expect(db.prepare(`SELECT typeof(qty) AS t, qty FROM stock`).get()).toEqual({ t: 'real', qty: 1.235 })
    db.close()
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

  it('sells decimal quantities without float drift, down to exactly zero', () => {
    run(`INSERT INTO stock (variant_id,qty) VALUES ('kg',2.335)`)
    commitLocalSale(saleRecord({ syncId: 's1', terminalSequence: '000010', items: [{ variant_id: 'kg', qty: 1.235 }] }))
    expect(get(`SELECT qty FROM stock WHERE variant_id='kg'`)).toEqual({ qty: 1.1 })
    commitLocalSale(saleRecord({ syncId: 's2', terminalSequence: '000011', items: [{ variant_id: 'kg', qty: 0.1 }] }))
    commitLocalSale(saleRecord({ syncId: 's3', terminalSequence: '000012', items: [{ variant_id: 'kg', qty: 1 }] }))
    expect(get(`SELECT qty FROM stock WHERE variant_id='kg'`)).toEqual({ qty: 0 })
    expect(() =>
      commitLocalSale(saleRecord({ syncId: 's4', terminalSequence: '000013', items: [{ variant_id: 'kg', qty: 0.001 }] })),
    ).toThrow(/Insufficient local stock for kg/)
  })

  it('refuses a quantity finer than the unit of the item before committing', () => {
    run(`INSERT INTO products (id,sku,name_ar,uom_precision) VALUES ('piece','P','قطعة',0),('kg','K','كجم',3),('dz','D','دستة',1)`)
    expect(() => assertQuantityPrecision([{ variant_id: 'piece', qty: 1.5 }])).toThrow(/كسور/)
    expect(() => assertQuantityPrecision([{ variant_id: 'dz', qty: 0.25 }])).toThrow(/كسور/)
    expect(() =>
      assertQuantityPrecision([
        { variant_id: 'piece', qty: 2 },
        { variant_id: 'kg', qty: 1.235 },
        { variant_id: 'dz', qty: 0.5 },
      ]),
    ).not.toThrow()
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
