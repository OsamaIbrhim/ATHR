import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCatalogPull } from './db/catalog-sync'
import { closeDb, initDb } from './db/connection'
import { run } from './db/queries'
import { wirePage, wireProduct } from './db/test-support'
import { hydrateHeldSale } from './held-sale-store'

// held-sale-store reaches secure-state, which imports Electron; CI installs
// no Electron binary, and these tests never touch the secure state.
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, safeStorage: {} }))

const SHIRT = '11111111-1111-4111-8111-111111111111'
const KG = '22222222-2222-4222-8222-222222222222'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athr-held-'))
  initDb(path.join(dir, 'athr_pos.sqlite'))
})

afterEach(() => {
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

const held = (itemsJson: string) => ({
  id: 'h1',
  customer_json: null,
  items_json: itemsJson,
  created_at: '2026-01-01T09:00:00.000Z',
  updated_at: '2026-01-01T09:00:00.000Z',
})

const catalog = () =>
  applyCatalogPull(
    wirePage({
      products: [
        wireProduct({ id: SHIRT, sku: 'S1', label: 'L · أسود' }),
        wireProduct({ id: KG, sku: 'KG', label: null, uom_name_ar: 'كجم', uom_precision: 3, selling_price: 10, unit_tax: 1.4, barcodes: [] }),
      ],
      stock: [
        { variant_id: SHIRT, qty_on_hand: 5 },
        { variant_id: KG, qty_on_hand: 3.5 },
      ],
    }),
  )

describe('held sales after the 1.6.0 upgrade', () => {
  it('restores a 1.5.1 draft (size/color extras, integer qty) with the label from the new catalog', () => {
    catalog()
    const sale = hydrateHeldSale(
      held(`[{"variant_id":"${SHIRT}","qty":2,"size":"L","color":"أسود","name":"قميص","unit_price":1}]`),
    )
    expect(sale.items).toHaveLength(1)
    expect(sale.items[0]).toMatchObject({
      variant_id: SHIRT,
      qty: 2,
      label: 'L · أسود',
      unit_price: 100,
      unit_tax: 14,
      available_qty: 5,
    })
    // Prices come from the catalog, never from the stored draft.
    expect(sale.total).toBe(228)
    expect(sale.item_count).toBe(1)
    expect(sale.items[0]).not.toHaveProperty('size')
  })

  it('cannot be restored until the first v3 snapshot has arrived (old rows are refused, not sold)', () => {
    // A row exactly as migration v4 leaves it: version 2, label derived from size/color.
    // Bypasses the wire validation: this is what the migrated table holds.
    run(`INSERT INTO products (id,sku,name_ar,catalog_version,selling_price_minor_units,unit_tax_minor_units) VALUES (?,?,?,?,?,?)`, [
      SHIRT, 'S1', 'قميص', 2, 10000, 1400,
    ])
    run(`INSERT INTO stock (variant_id,qty) VALUES (?,5)`, [SHIRT])
    expect(() => hydrateHeldSale(held(`[{"variant_id":"${SHIRT}","qty":1}]`))).toThrow(/تغير أو لم تعد كميته كافية/)
  })

  it('restores decimal quantities and prices them like the server', () => {
    catalog()
    const sale = hydrateHeldSale(held(`[{"variant_id":"${KG}","qty":1.235}]`))
    expect(sale.items[0]).toMatchObject({ qty: 1.235, available_qty: 3.5, uom_name_ar: 'كجم' })
    // 10.00 x 1.235 = 12.35 and 1.40 x 1.235 = 1.729 -> 1.73
    expect(sale.total).toBe(14.08)
  })

  it('refuses a quantity finer than the unit or above the stock', () => {
    catalog()
    expect(() => hydrateHeldSale(held(`[{"variant_id":"${SHIRT}","qty":1.5}]`))).toThrow(/تغير أو لم تعد كميته كافية/)
    expect(() => hydrateHeldSale(held(`[{"variant_id":"${KG}","qty":3.501}]`))).toThrow(/تغير أو لم تعد كميته كافية/)
  })
})
