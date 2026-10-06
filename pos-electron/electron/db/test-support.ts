/** Fixtures for the local-database tests: server catalog pages in the protocol 3 wire format. */
import type { ScaleBarcodeConfig } from '@athr/domain-core'

export const SCALE_SETTINGS: { scale_barcode: ScaleBarcodeConfig } = {
  scale_barcode: { enabled: true, prefixes: ['20', '21'], item_digits: 5, value: 'weight', decimals: 3, price_includes_tax: true },
}

export function wireProduct(over: Record<string, unknown> = {}) {
  return {
    catalog_version: 3,
    id: 'v1',
    sku: 'SKU-1',
    name_en: 'Shirt',
    name_ar: 'قميص',
    label: 'L · أسود',
    attributes: { size: 'L', color: 'أسود' },
    uom_code: 'pcs',
    uom_name_ar: 'قطعة',
    uom_precision: 0,
    barcodes: [{ code: '6221234567890', pack_qty: 1, kind: 'standard' }],
    selling_price: 100,
    unit_tax: 14,
    tax_rate: 14,
    tax_mode: 'exclusive',
    price_issued_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

export function wirePage(over: Record<string, unknown> = {}) {
  return {
    catalog_version: 3,
    mode: 'snapshot',
    cursor: '7:3',
    server_time: '2026-01-01T00:00:00.000Z',
    catalog_valid_until: '2026-01-02T00:00:00.000Z',
    products: [wireProduct()],
    stock: [{ branch_id: 'b', variant_id: 'v1', qty_on_hand: 5, qty_reserved: 0 }],
    deleted_variant_ids: [],
    snapshot_after: null,
    has_more: false,
    reset_products: true,
    reset_stock: true,
    reset_sellers: true,
    sellers: [],
    settings: SCALE_SETTINGS,
    ...over,
  }
}
