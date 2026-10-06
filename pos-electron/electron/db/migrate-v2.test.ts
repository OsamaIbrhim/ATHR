import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, openDatabase } from './connection'
import { APPLICATION_ID } from './migrations'
import { SCHEMA_V1 } from './schema'

let dir: string
let file: string
let opened: Database.Database | null = null
const open = () => (opened = openDatabase(file))

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athr-mig-'))
  file = path.join(dir, 'athr_pos.sqlite')
})
afterEach(() => {
  opened?.close()
  opened = null
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A released version-1 till holding one unsent sale, one sent sale and a product. */
function releasedV1() {
  const old = new Database(file)
  old.exec(SCHEMA_V1)
  old.pragma(`application_id = ${APPLICATION_ID}`)
  old.pragma('user_version = 1')
  old.prepare(`INSERT INTO products (id,sku) VALUES ('v1','S1')`).run()
  const sale = old.prepare(
    `INSERT INTO sales_local (sync_id,invoice_number,total_minor_units,payment_method,terminal_sequence) VALUES (?,?,?,?,?)`,
  )
  const queue = old.prepare(`INSERT INTO outbox (id,type,payload,sync_status,terminal_sequence) VALUES (?,?,?,?,?)`)
  const command = (id: string, method: string) =>
    JSON.stringify({ event_version: 2, sync_id: id, payment_method: method, local_total: 114, items: [] })
  sale.run('pending-1', 'LOCAL-POS1-1', 11400, 'instapay', '1')
  queue.run('pending-1', 'sale', command('pending-1', 'instapay'), 'pending', '1')
  sale.run('sent-1', 'LOCAL-POS1-2', 5000, 'cash', '2')
  queue.run('sent-1', 'sale', command('sent-1', 'cash'), 'sent', '2')
  old.close()
}

describe('migration 2 (W3 sales)', () => {
  it('rewrites unsent sales to payments[] and keeps every row', () => {
    releasedV1()
    const db = open()
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    const unsent = JSON.parse((db.prepare(`SELECT payload FROM outbox WHERE id='pending-1'`).get() as any).payload)
    expect(unsent.payments).toEqual([{ method: 'bank_transfer', amount: 114 }])
    expect(unsent.invoice_number).toBe('LOCAL-POS1-1')
    expect(unsent.payment_method).toBeUndefined()
    // A sale the server already has is not touched.
    const sent = JSON.parse((db.prepare(`SELECT payload FROM outbox WHERE id='sent-1'`).get() as any).payload)
    expect(sent.payment_method).toBe('cash')
    expect((db.prepare(`SELECT COUNT(*) AS n FROM sales_local`).get() as any).n).toBe(2)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM outbox`).get() as any).n).toBe(2)
  })

  it('fills payments_json for existing local sales and leaves old products without a tax rate', () => {
    releasedV1()
    const db = open()
    const row = db.prepare(`SELECT payments_json,discount_minor_units FROM sales_local WHERE sync_id='sent-1'`).get() as any
    expect(JSON.parse(row.payments_json)).toEqual([{ method: 'cash', amount: 50 }])
    expect(row.discount_minor_units).toBe(0)
    expect((db.prepare(`SELECT tax_rate FROM products WHERE id='v1'`).get() as any).tax_rate).toBeNull()
  })
})
