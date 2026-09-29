import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './connection'
import { CREATE_INDEXES, CREATE_TABLES } from './schema'

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athr-v4-'))
  file = path.join(dir, 'athr_pos.sqlite')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A database exactly as release 1.5.1 leaves it: schema v3 with a busy till's data. */
function createV3Database() {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(CREATE_TABLES)
  db.exec(CREATE_INDEXES)
  db.exec(`
    INSERT INTO products (id,sku,name_en,name_ar,barcode_ean13,barcode_internal,size,color,cost_price,selling_price,
      unit_tax,catalog_version,cost_price_minor_units,selling_price_minor_units,unit_tax_minor_units)
      VALUES ('p1','SKU-1','Shirt','قميص','6221234567890','ATHR-1','L','أسود',0,100,14,2,0,10000,1400),
             ('p2','SKU-2','Cap','قبعة',NULL,'',NULL,'أحمر',0,50,7,2,0,5000,700),
             ('p3','SKU-3','Belt','حزام','6220000000001',NULL,NULL,NULL,0,80,0,2,0,8000,0);
    INSERT INTO stock (variant_id,qty) VALUES ('p1',7),('p2',NULL),('p3',0);
    INSERT INTO sellers (id,name) VALUES ('s1','Seller One');
    INSERT INTO outbox (id,type,payload,sync_status,created_at,attempt_count,last_attempt_at,last_error,
      server_document_id,server_document_number,terminal_sequence,warning_codes,updated_at) VALUES
      ('sale-1','sale','{"sync_id":"sale-1","items":[{"variant_id":"p1","qty":2,"size_snapshot":"L","color_snapshot":"أسود"}]}',
        'pending','2026-01-01T10:00:00.000Z',2,'2026-01-01T10:01:00.000Z','HTTP 503',NULL,NULL,'000001','[]','2026-01-01T10:01:00.000Z'),
      ('sale-2','sale','{"sync_id":"sale-2"}','sending','2026-01-01T10:05:00.000Z',0,NULL,NULL,NULL,NULL,'000002',NULL,NULL),
      ('sale-3','sale','{"sync_id":"sale-3"}','quarantined','2026-01-01T10:06:00.000Z',1,'2026-01-01T10:07:00.000Z','409',NULL,NULL,'000003','["PRICE_VARIANCE"]',NULL);
    INSERT INTO sales_local (sync_id,invoice_number,total,created_at,occurred_at,payment_method,customer_phone,cashier_id,
      seller_id,shift_id,offline_session_id,terminal_sequence,total_minor_units)
      VALUES ('sale-1','LOCAL-T1-000001',228,'2026-01-01T10:00:00.000Z','2026-01-01T10:00:00.000Z','cash',NULL,'c1','s1','sh1','os1','000001',22800);
    INSERT INTO held_sales (id,branch_id,cashier_id,shift_id,customer_json,items_json,created_at,updated_at) VALUES
      ('h1','b1','c1','sh1','{"phone":"01012345678"}','[{"variant_id":"p1","qty":2,"size":"L","color":"أسود","name":"قميص"}]','2026-01-01T09:00:00.000Z','2026-01-01T09:00:00.000Z'),
      ('h2','b1','c1','sh1',NULL,'[{"variant_id":"p3","qty":1}]','2026-01-01T09:30:00.000Z','2026-01-01T09:30:00.000Z');
    INSERT INTO sync_meta (key,value) VALUES
      ('device_id','device-1'),('terminal_name','Till 1'),('terminal_sale_sequence','000003'),('sync_status','success'),
      ('sync_cursor','12345'),('catalog_format_version','offline-sales-v2'),('catalog_valid_until','2026-02-01T00:00:00.000Z');
  `)
  db.pragma('user_version = 3')
  db.close()
}

/** Every column of every row as SQL literal text, so 5 and 5.0 (INTEGER vs REAL) differ. */
function dump(db: Database.Database, table: string) {
  const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
  const select = columns.map((c) => `quote("${c}") AS "${c}"`).join(',')
  return db.prepare(`SELECT ${select} FROM ${table} ORDER BY rowid`).all()
}

const schema = (db: Database.Database) => ({
  version: db.pragma('user_version', { simple: true }),
  tables: Object.fromEntries(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as any[]).map(
      ({ name }) => [name, db.prepare(`PRAGMA table_info(${name})`).all()],
    ),
  ),
  indexes: (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as any[]).map(
    ({ name }) => name,
  ),
})

describe('migration v4 (generic catalog)', () => {
  it('leaves pending outbox rows, sales and held sales of a v3 database byte-identical', () => {
    createV3Database()
    const before = new Database(file, { readonly: true })
    const expected = {
      outbox: dump(before, 'outbox'),
      sales_local: dump(before, 'sales_local'),
      held_sales: dump(before, 'held_sales'),
      sellers: dump(before, 'sellers'),
    }
    before.close()

    const db = openDatabase(file)

    expect(db.pragma('user_version', { simple: true })).toBe(4)
    expect(dump(db, 'outbox')).toEqual(expected.outbox)
    expect(dump(db, 'sales_local')).toEqual(expected.sales_local)
    expect(dump(db, 'held_sales')).toEqual(expected.held_sales)
    expect(dump(db, 'sellers')).toEqual(expected.sellers)
    // Sanity: the fixture really had a pending, an interrupted and a held sale.
    expect(db.prepare(`SELECT sync_status FROM outbox ORDER BY id`).all()).toEqual([
      { sync_status: 'pending' },
      { sync_status: 'sending' },
      { sync_status: 'quarantined' },
    ])
    expect(db.prepare(`SELECT COUNT(*) AS n FROM held_sales`).get()).toEqual({ n: 2 })
    db.close()
  })

  it('keeps device identity and the sale sequence, but clears the catalog cursor so a snapshot follows', () => {
    createV3Database()
    const db = openDatabase(file)
    const meta = Object.fromEntries(
      (db.prepare(`SELECT key,value FROM sync_meta`).all() as any[]).map((row) => [row.key, row.value]),
    )
    expect(meta).toMatchObject({
      device_id: 'device-1',
      terminal_name: 'Till 1',
      terminal_sale_sequence: '000003',
      sync_status: 'success',
    })
    for (const key of ['sync_cursor', 'catalog_format_version', 'catalog_valid_until', 'snapshot_after', 'snapshot_cursor']) {
      expect(meta).not.toHaveProperty(key)
    }
    db.close()
  })

  it('rebuilds products and stock: label from size/color, old barcodes kept, decimal stock', () => {
    createV3Database()
    const db = openDatabase(file)

    expect(db.prepare(`SELECT id,label,attributes,uom_precision,catalog_version,selling_price_minor_units FROM products ORDER BY id`).all()).toEqual([
      { id: 'p1', label: 'L · أسود', attributes: null, uom_precision: 0, catalog_version: 2, selling_price_minor_units: 10000 },
      { id: 'p2', label: 'أحمر', attributes: null, uom_precision: 0, catalog_version: 2, selling_price_minor_units: 5000 },
      { id: 'p3', label: null, attributes: null, uom_precision: 0, catalog_version: 2, selling_price_minor_units: 8000 },
    ])
    expect(db.prepare(`SELECT code,variant_id,pack_qty,kind FROM barcodes ORDER BY code`).all()).toEqual([
      { code: '6220000000001', variant_id: 'p3', pack_qty: 1, kind: 'standard' },
      { code: '6221234567890', variant_id: 'p1', pack_qty: 1, kind: 'standard' },
      { code: 'ATHR-1', variant_id: 'p1', pack_qty: 1, kind: 'standard' },
    ])
    expect(db.prepare(`SELECT variant_id,qty FROM stock ORDER BY variant_id`).all()).toEqual([
      { variant_id: 'p1', qty: 7 },
      { variant_id: 'p2', qty: 0 },
      { variant_id: 'p3', qty: 0 },
    ])
    db.prepare(`UPDATE stock SET qty=1.235 WHERE variant_id='p1'`).run()
    expect(db.prepare(`SELECT typeof(qty) AS t, qty FROM stock WHERE variant_id='p1'`).get()).toEqual({ t: 'real', qty: 1.235 })

    // Old rows are version 2, so the app treats the catalog as needing a full refresh.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM products WHERE catalog_version<>3`).get()).toEqual({ n: 3 })
    db.close()
  })

  it('a fresh database ends at the same schema as an upgraded one', () => {
    createV3Database()
    const upgraded = openDatabase(file)
    const fresh = openDatabase(path.join(dir, 'fresh.sqlite'))
    expect(schema(upgraded)).toEqual(schema(fresh))
    expect(schema(fresh).version).toBe(4)
    expect(schema(fresh).tables).toHaveProperty('barcodes')
    expect(schema(fresh).indexes).toEqual(expect.arrayContaining(['barcodes_variant_idx', 'products_sku_idx']))
    upgraded.close()
    fresh.close()
  })

  it('barcode codes are unique: one code belongs to one variant', () => {
    const db = openDatabase(file)
    db.prepare(`INSERT INTO barcodes (code,variant_id,pack_qty,kind) VALUES ('c','a',1,'standard')`).run()
    expect(() =>
      db.prepare(`INSERT INTO barcodes (code,variant_id,pack_qty,kind) VALUES ('c','b',1,'standard')`).run(),
    ).toThrow(/UNIQUE/)
    db.close()
  })
})
