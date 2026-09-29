import { ean13CheckDigit } from '@athr/domain-core'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyCatalogPull } from './catalog-sync'
import { closeDb, initDb } from './connection'
import { q } from './queries'
import { SCAN_QUERIES, scan, scaleQuantity } from './scan'
import { SCALE_SETTINGS, wirePage, wireProduct } from './test-support'

let dir: string

/** A valid EAN-13 scale label: PLU (prefix + item code) + 5 value digits + check digit. */
function scaleLabel(plu: string, valueDigits: string) {
  const first12 = `${plu}${valueDigits}`
  return `${first12}${ean13CheckDigit(first12)}`
}

const shirt = wireProduct({
  id: 'shirt',
  sku: 'SHIRT-L',
  label: 'L · أسود',
  barcodes: [
    { code: '6221234567890', pack_qty: 1, kind: 'standard' },
    { code: '6221234500006', pack_qty: 6, kind: 'standard' },
  ],
})

// 10.00 net + 1.40 tax per kg.
const tomato = wireProduct({
  id: 'tomato',
  sku: 'TOMATO',
  name_ar: 'طماطم',
  name_en: 'Tomato',
  label: null,
  uom_code: 'kg',
  uom_name_ar: 'كجم',
  uom_precision: 3,
  selling_price: 10,
  unit_tax: 1.4,
  barcodes: [{ code: '2000001', pack_qty: 1, kind: 'scale_plu' }],
})

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athr-scan-'))
  initDb(path.join(dir, 'athr_pos.sqlite'))
  applyCatalogPull(
    wirePage({
      products: [shirt, tomato],
      stock: [
        { variant_id: 'shirt', qty_on_hand: 40 },
        { variant_id: 'tomato', qty_on_hand: 20.5 },
      ],
    }),
  )
})

afterEach(() => {
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('scan resolution', () => {
  it('an exact barcode adds its pack size, with the synchronized stock', () => {
    expect(scan('6221234567890')).toMatchObject({ kind: 'barcode', qty: 1, products: [{ id: 'shirt', qty: 40 }] })
    const pack = scan('6221234500006')
    expect(pack).toMatchObject({ kind: 'barcode', qty: 6, products: [{ id: 'shirt' }] })
    expect(pack.products[0]).not.toHaveProperty('pack_qty')
  })

  it('an exact SKU adds one', () => {
    expect(scan('SHIRT-L')).toMatchObject({ kind: 'sku', qty: 1, products: [{ id: 'shirt' }] })
    expect(scan('  SHIRT-L  ')).toMatchObject({ kind: 'sku' })
  })

  it('a barcode wins over a SKU spelled the same', () => {
    applyCatalogPull(
      wirePage({
        products: [
          wireProduct({ id: 'a', sku: 'X100', barcodes: [] }),
          wireProduct({ id: 'b', sku: 'OTHER', barcodes: [{ code: 'X100', pack_qty: 2, kind: 'standard' }] }),
        ],
        stock: [],
      }),
    )
    expect(scan('X100')).toMatchObject({ kind: 'barcode', qty: 2, products: [{ id: 'b' }] })
  })

  it('a weight scale label gives the weight as the quantity', () => {
    // prefix 20, item 00001, weight 01.250 kg
    expect(scan(scaleLabel('2000001', '01250'))).toMatchObject({
      kind: 'scale',
      qty: 1.25,
      products: [{ id: 'tomato', qty: 20.5 }],
    })
  })

  it('a price scale label divides by the unit price including tax, rounded to the unit precision', () => {
    applyCatalogPull(
      wirePage({
        cursor: '8:0',
        products: [tomato],
        stock: [],
        settings: { scale_barcode: { ...SCALE_SETTINGS.scale_barcode, value: 'price', decimals: 2 } },
      }),
    )
    // Label price 11.40 = exactly 1 kg at 11.40 gross.
    expect(scan(scaleLabel('2000001', '01140'))).toMatchObject({ kind: 'scale', qty: 1 })
    // 12.35 / 11.40 = 1.08333... -> 1.083 kg
    expect(scan(scaleLabel('2000001', '01235'))).toMatchObject({ kind: 'scale', qty: 1.083 })
  })

  it('falls through when the label cannot be honoured', () => {
    // Unknown PLU.
    expect(scan(scaleLabel('2000009', '01250'))).toMatchObject({ kind: 'search', products: [] })
    // Zero weight.
    expect(scan(scaleLabel('2000001', '00000'))).toMatchObject({ kind: 'search', products: [] })
    // Prefix not configured.
    expect(scan(scaleLabel('3000001', '01250'))).toMatchObject({ kind: 'search', products: [] })
    // Bad check digit.
    const label = scaleLabel('2000001', '01250')
    const broken = `${label.slice(0, 12)}${(Number(label[12]) + 1) % 10}`
    expect(scan(broken)).toMatchObject({ kind: 'search', products: [] })
  })

  it('ignores scale labels while the tenant has them switched off', () => {
    applyCatalogPull(
      wirePage({
        cursor: '8:0',
        products: [tomato],
        stock: [],
        settings: { scale_barcode: { ...SCALE_SETTINGS.scale_barcode, enabled: false } },
      }),
    )
    expect(scan(scaleLabel('2000001', '01250'))).toMatchObject({ kind: 'search', products: [] })
  })

  it('a typed PLU that is a registered barcode is an ordinary barcode hit', () => {
    expect(scan('2000001')).toMatchObject({ kind: 'barcode', qty: 1, products: [{ id: 'tomato' }] })
  })

  it('falls back to a limited text search over sku, names and label', () => {
    expect(scan('أسود').products.map((p) => p.id)).toEqual(['shirt'])
    expect(scan('tom')).toMatchObject({ kind: 'search', qty: 1, products: [{ id: 'tomato' }] })
    expect(scan('طماطم').products).toHaveLength(1)
    expect(scan('nomatch-xyz')).toMatchObject({ kind: 'search', products: [] })
    expect(scan('   ')).toMatchObject({ kind: 'search', products: [] })
    expect(scan(undefined)).toMatchObject({ products: [] })
  })

  it('caps text search results', () => {
    applyCatalogPull(
      wirePage({
        cursor: '9:0',
        products: Array.from({ length: 60 }, (_, i) =>
          wireProduct({ id: `id-${i}`, sku: `BULK-${String(i).padStart(3, '0')}`, barcodes: [] }),
        ),
        stock: [],
      }),
    )
    expect(scan('BULK').products).toHaveLength(50)
  })
})

describe('scale quantity math', () => {
  const gross = (net: number, tax: number) => ({
    selling_price_minor_units: net * 100,
    unit_tax_minor_units: tax * 100,
  })

  it('weights are rounded half up to the unit precision', () => {
    const reading = { plu: 'p', kind: 'weight' as const, value: 1.235 }
    expect(scaleQuantity(reading, { uom_precision: 3 })).toBe(1.235)
    expect(scaleQuantity(reading, { uom_precision: 2 })).toBe(1.24)
    expect(scaleQuantity(reading, { uom_precision: 0 })).toBe(1)
  })

  it('prices need a positive unit price', () => {
    const reading = { plu: 'p', kind: 'price' as const, value: 5 }
    expect(scaleQuantity(reading, { ...gross(0, 0), uom_precision: 3 })).toBe(0)
    expect(scaleQuantity(reading, { ...gross(10, 0), uom_precision: 3 })).toBe(0.5)
    expect(scaleQuantity(reading, { ...gross(10, 0), uom_precision: 0 })).toBe(1)
  })
})

describe('scan speed: every step is one indexed probe', () => {
  const plan = (sql: string) =>
    q(`EXPLAIN QUERY PLAN ${sql.replaceAll('?', "'x'")}`)
      .map((row) => row.detail)
      .join('\n')

  it('barcode lookup uses the barcodes primary key and never scans the catalog', () => {
    const details = plan(SCAN_QUERIES.BARCODE_SQL)
    expect(details).toMatch(/SEARCH b USING (INDEX|COVERING INDEX) sqlite_autoindex_barcodes_1/)
    expect(details).not.toMatch(/SCAN (b|p|s)\b/)
  })

  it('scale PLU lookup uses the same index', () => {
    expect(plan(SCAN_QUERIES.SCALE_PLU_SQL)).toMatch(/SEARCH b USING .*sqlite_autoindex_barcodes_1/)
  })

  it('SKU lookup uses products_sku_idx', () => {
    const details = plan(SCAN_QUERIES.SKU_SQL)
    expect(details).toContain('products_sku_idx')
    expect(details).not.toMatch(/SCAN p\b/)
  })
})
