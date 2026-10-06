import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { catalogNeedsFullRefresh, snapshotProgress } from './catalog'
import { applyCatalogPull } from './catalog-sync'
import { closeDb, initDb } from './connection'
import { get, getMeta, q, setMeta } from './queries'
import { wirePage, wireProduct } from './test-support'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athr-sync-'))
  initDb(path.join(dir, 'athr_pos.sqlite'))
})

afterEach(() => {
  closeDb()
  fs.rmSync(dir, { recursive: true, force: true })
})

const catalogState = () => ({
  products: q(`SELECT id FROM products ORDER BY id`).map((row) => row.id),
  barcodes: q(`SELECT code FROM barcodes ORDER BY code`).map((row) => row.code),
  stock: q(`SELECT variant_id,qty FROM stock ORDER BY variant_id`),
  cursor: getMeta('sync_cursor'),
  format: getMeta('catalog_format_version'),
  validUntil: getMeta('catalog_valid_until'),
})

/** The pages of a 3-page snapshot at cursor 7:3, one variant each. */
const snapshotPages = () => [
  wirePage({
    products: [wireProduct({ id: 'v1', sku: 'S1', barcodes: [{ code: 'B1', pack_qty: 1, kind: 'standard' }] })],
    stock: [{ variant_id: 'v1', qty_on_hand: 5 }],
    snapshot_after: 'v1',
    has_more: true,
  }),
  wirePage({
    products: [wireProduct({ id: 'v2', sku: 'S2', barcodes: [{ code: 'B2', pack_qty: 6, kind: 'standard' }] })],
    stock: [{ variant_id: 'v2', qty_on_hand: 2.5 }],
    snapshot_after: 'v2',
    has_more: true,
    reset_products: false,
    reset_stock: false,
    reset_sellers: false,
    sellers: undefined,
    settings: undefined,
  }),
  wirePage({
    products: [wireProduct({ id: 'v3', sku: 'S3', barcodes: [] })],
    stock: [],
    snapshot_after: null,
    has_more: false,
    reset_products: false,
    reset_stock: false,
    reset_sellers: false,
    sellers: undefined,
    settings: undefined,
  }),
]

describe('catalog snapshot (protocol 3)', () => {
  it('stores products with label, unit, barcodes, decimal stock, sellers and tenant settings', () => {
    applyCatalogPull(
      wirePage({
        products: [
          wireProduct({
            uom_code: 'kg',
            uom_name_ar: 'كجم',
            uom_precision: 3,
            barcodes: [
              { code: '6221234567890', pack_qty: 1, kind: 'standard' },
              { code: '2100001', pack_qty: 1, kind: 'scale_plu' },
            ],
          }),
        ],
        stock: [{ variant_id: 'v1', qty_on_hand: 12.345 }],
        sellers: [{ id: '11111111-1111-4111-8111-111111111111', name: ' Ali ' }],
      }),
    )
    expect(get(`SELECT * FROM products WHERE id='v1'`)).toMatchObject({
      sku: 'SKU-1',
      label: 'L · أسود',
      attributes: '{"size":"L","color":"أسود"}',
      uom_code: 'kg',
      uom_name_ar: 'كجم',
      uom_precision: 3,
      catalog_version: 3,
      selling_price_minor_units: 10000,
      unit_tax_minor_units: 1400,
    })
    expect(q(`SELECT code,pack_qty,kind FROM barcodes ORDER BY code`)).toEqual([
      { code: '2100001', pack_qty: 1, kind: 'scale_plu' },
      { code: '6221234567890', pack_qty: 1, kind: 'standard' },
    ])
    expect(get(`SELECT qty FROM stock WHERE variant_id='v1'`)).toEqual({ qty: 12.345 })
    expect(q(`SELECT name FROM sellers`)).toEqual([{ name: 'Ali' }])
    expect(JSON.parse(getMeta('tenant_settings')).scale_barcode.enabled).toBe(true)
    expect(catalogNeedsFullRefresh()).toBe(false)
    expect(getMeta('sync_cursor')).toBe('7:3')
  })

  it('writes the cursor and format version only after the LAST page', () => {
    // A till with a complete, older catalog and cursor.
    applyCatalogPull(wirePage({ cursor: '5:0' }))
    expect(getMeta('sync_cursor')).toBe('5:0')

    const [first, second, last] = snapshotPages()

    applyCatalogPull(first)
    // Old catalog gone, old cursor gone: a crash now cannot leave a partial catalog behind a valid cursor.
    expect(catalogState()).toMatchObject({ products: ['v1'], cursor: '', format: '', validUntil: '' })
    expect(catalogNeedsFullRefresh()).toBe(true)
    expect(snapshotProgress()).toEqual({ after: 'v1', cursor: '7:3' })

    applyCatalogPull(second)
    expect(catalogState()).toMatchObject({ products: ['v1', 'v2'], cursor: '', format: '' })
    expect(snapshotProgress()).toEqual({ after: 'v2', cursor: '7:3' })

    applyCatalogPull(last)
    expect(catalogState()).toMatchObject({
      products: ['v1', 'v2', 'v3'],
      barcodes: ['B1', 'B2'],
      cursor: '7:3',
      format: 'offline-sales-v4',
      validUntil: '2026-01-02T00:00:00.000Z',
    })
    expect(snapshotProgress()).toBeNull()
    expect(catalogNeedsFullRefresh()).toBe(false)
    expect(q(`SELECT variant_id,qty FROM stock ORDER BY variant_id`)).toEqual([
      { variant_id: 'v1', qty: 5 },
      { variant_id: 'v2', qty: 2.5 },
    ])
  })

  it('survives a restart between pages: the progress is still there to resume from', () => {
    const [first] = snapshotPages()
    applyCatalogPull(first)
    closeDb()
    initDb(path.join(dir, 'athr_pos.sqlite'))
    expect(snapshotProgress()).toEqual({ after: 'v1', cursor: '7:3' })
    expect(catalogNeedsFullRefresh()).toBe(true)
  })

  it('rejects a continuation page that does not belong to the snapshot in progress', () => {
    const [first, second] = snapshotPages()
    applyCatalogPull(first)
    expect(() => applyCatalogPull({ ...second, cursor: '7:4' })).toThrow(/does not continue/)
    expect(catalogState().products).toEqual(['v1'])

    closeDb()
    initDb(path.join(dir, 'fresh.sqlite'))
    expect(() => applyCatalogPull(second)).toThrow(/does not continue/)
  })

  it('a page without the next position cannot be applied', () => {
    const [first] = snapshotPages()
    expect(() => applyCatalogPull({ ...first, snapshot_after: null })).toThrow(/where the catalog snapshot continues/)
    expect(catalogState().products).toEqual([])
  })

  it('a malformed page changes nothing (old catalog and cursor stay usable)', () => {
    applyCatalogPull(wirePage({ cursor: '5:0' }))
    const before = catalogState()
    const bad = [
      wirePage({ products: [wireProduct({ barcodes: undefined })] }),
      wirePage({ products: [wireProduct({ uom_precision: 9 })] }),
      wirePage({ stock: [{ variant_id: 'v1', qty_on_hand: 1.2345 }] }),
      wirePage({ settings: { scale_barcode: { enabled: 'yes' } } }),
      wirePage({ catalog_version: 2 }),
      wirePage({ mode: 'other' }),
    ]
    for (const page of bad) expect(() => applyCatalogPull(page)).toThrow()
    expect(catalogState()).toEqual(before)
  })
})

describe('catalog delta (protocol 3)', () => {
  beforeEach(() => {
    applyCatalogPull(
      wirePage({
        cursor: '5:0',
        products: [
          wireProduct({ id: 'v1', sku: 'S1', barcodes: [{ code: 'OLD', pack_qty: 1, kind: 'standard' }] }),
          wireProduct({ id: 'v2', sku: 'S2', barcodes: [{ code: 'B2', pack_qty: 1, kind: 'standard' }] }),
        ],
        stock: [
          { variant_id: 'v1', qty_on_hand: 5 },
          { variant_id: 'v2', qty_on_hand: 1 },
        ],
      }),
    )
  })

  const delta = (over: Record<string, unknown>) => ({
    catalog_version: 3,
    mode: 'delta',
    cursor: '6:1',
    catalog_valid_until: '2026-01-03T00:00:00.000Z',
    products: [],
    stock: [],
    deleted_variant_ids: [],
    has_more: false,
    reset_products: false,
    reset_stock: false,
    reset_sellers: false,
    ...over,
  })

  it('changes only what it names: price, replaced barcodes, stock, deletions', () => {
    applyCatalogPull(
      delta({
        products: [wireProduct({ id: 'v1', sku: 'S1', selling_price: 120, barcodes: [{ code: 'NEW', pack_qty: 12, kind: 'standard' }] })],
        stock: [{ variant_id: 'v1', qty_on_hand: 4.5 }],
        deleted_variant_ids: ['v2'],
      }),
    )
    expect(catalogState()).toMatchObject({
      products: ['v1'],
      barcodes: ['NEW'],
      stock: [{ variant_id: 'v1', qty: 4.5 }],
      cursor: '6:1',
    })
    expect(get(`SELECT selling_price_minor_units AS p FROM products WHERE id='v1'`)).toEqual({ p: 12000 })
  })

  it('updates the tenant settings only when the delta carries them', () => {
    applyCatalogPull(delta({}))
    expect(JSON.parse(getMeta('tenant_settings')).scale_barcode.enabled).toBe(true)
    applyCatalogPull(
      delta({
        cursor: '6:2',
        settings: { scale_barcode: { enabled: false, prefixes: ['20'], item_digits: 5, value: 'price', decimals: 2 } },
      }),
    )
    expect(JSON.parse(getMeta('tenant_settings')).scale_barcode).toMatchObject({ enabled: false, value: 'price' })
  })

  it('is refused while a snapshot is unfinished or the catalog needs a refresh', () => {
    setMeta('snapshot_cursor', '9:9')
    setMeta('snapshot_after', 'v1')
    expect(() => applyCatalogPull(delta({}))).toThrow(/complete catalog snapshot is required/)
    setMeta('snapshot_cursor', '')
    setMeta('catalog_format_version', '')
    expect(() => applyCatalogPull(delta({}))).toThrow(/complete catalog snapshot is required/)
  })
})
