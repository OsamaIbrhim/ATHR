import { describe, expect, it } from 'vitest'
import {
  CATALOG_FORMAT_VERSION,
  isValidCatalogProduct,
  isValidCatalogStock,
  isValidWireProduct,
  requiresFullCatalogRefresh,
} from '../electron/catalog-format'

describe('offline sales v3 catalog', () => {
  const product = {
    id: 'variant-1',
    sku: 'SKU-1',
    name_ar: 'منتج',
    name_en: 'Product',
    selling_price: 150,
    unit_tax: 21,
    catalog_version: 3,
  }

  it('forces one full snapshot when the local catalog contract changes', () => {
    expect(requiresFullCatalogRefresh('', 0)).toBe(true)
    expect(requiresFullCatalogRefresh('signed-price-kid-v2', 0)).toBe(true)
    expect(requiresFullCatalogRefresh(CATALOG_FORMAT_VERSION, 1)).toBe(true)
    expect(requiresFullCatalogRefresh(CATALOG_FORMAT_VERSION, 0)).toBe(false)
  })

  it('accepts historical price inputs without a cryptographic token', () => {
    expect(isValidCatalogProduct(product)).toBe(true)
    expect(isValidCatalogProduct({ ...product, selling_price: -1 })).toBe(false)
    expect(isValidCatalogProduct({ ...product, sku: '' })).toBe(false)
    expect(isValidCatalogProduct({ ...product, catalog_version: 1 })).toBe(false)
  })

  it('a v2 catalog (older tills) forces the full refresh', () => {
    expect(CATALOG_FORMAT_VERSION).toBe('offline-sales-v3')
    expect(requiresFullCatalogRefresh('offline-sales-v2', 0)).toBe(true)
    expect(isValidCatalogProduct({ ...product, catalog_version: 2 })).toBe(false)
  })

  it('validates the wire product: unit precision and barcodes', () => {
    const wire = {
      ...product,
      label: 'L · أسود',
      uom_precision: 3,
      barcodes: [
        { code: '6221234567890', pack_qty: 1, kind: 'standard' },
        { code: '2100001', pack_qty: 1, kind: 'scale_plu' },
      ],
    }
    expect(isValidWireProduct(wire)).toBe(true)
    expect(isValidWireProduct({ ...wire, label: null, barcodes: [] })).toBe(true)
    expect(isValidWireProduct({ ...wire, barcodes: undefined })).toBe(false)
    expect(isValidWireProduct({ ...wire, uom_precision: 4 })).toBe(false)
    expect(isValidWireProduct({ ...wire, uom_precision: 1.5 })).toBe(false)
    expect(isValidWireProduct({ ...wire, barcodes: [{ code: '', pack_qty: 1, kind: 'standard' }] })).toBe(false)
    expect(isValidWireProduct({ ...wire, barcodes: [{ code: 'x', pack_qty: 0, kind: 'standard' }] })).toBe(false)
    expect(isValidWireProduct({ ...wire, barcodes: [{ code: 'x', pack_qty: 1, kind: 'other' }] })).toBe(false)
  })

  it('rejects malformed or negative synchronized stock', () => {
    expect(isValidCatalogStock({
      variant_id: 'variant-1',
      qty_on_hand: '12',
    })).toBe(true)
    expect(isValidCatalogStock({
      variant_id: 'variant-1',
      qty_on_hand: -1,
    })).toBe(false)
    expect(isValidCatalogStock({ variant_id: 'variant-1', qty_on_hand: 12.345 })).toBe(true)
    expect(isValidCatalogStock({ variant_id: 'variant-1', qty_on_hand: 0 })).toBe(true)
    expect(isValidCatalogStock({ variant_id: 'variant-1', qty_on_hand: 1.2345 })).toBe(false)
    expect(isValidCatalogStock({ variant_id: 'variant-1', qty_on_hand: 'x' })).toBe(false)
    expect(isValidCatalogStock({
      variant_id: '',
      qty_on_hand: 1,
    })).toBe(false)
  })
})
