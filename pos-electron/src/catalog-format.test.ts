import { describe, expect, it } from 'vitest'
import {
  CATALOG_FORMAT_VERSION,
  isValidCatalogProduct,
  isValidCatalogStock,
  requiresFullCatalogRefresh,
} from '../electron/catalog-format'

describe('offline sales v2 catalog', () => {
  const product = {
    id: 'variant-1',
    sku: 'SKU-1',
    name_ar: 'منتج',
    name_en: 'Product',
    selling_price: 150,
    unit_tax: 21,
    catalog_version: 2,
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

  it('rejects malformed or negative synchronized stock', () => {
    expect(isValidCatalogStock({
      variant_id: 'variant-1',
      qty_on_hand: '12',
    })).toBe(true)
    expect(isValidCatalogStock({
      variant_id: 'variant-1',
      qty_on_hand: -1,
    })).toBe(false)
    expect(isValidCatalogStock({
      variant_id: '',
      qty_on_hand: 1,
    })).toBe(false)
  })
})
