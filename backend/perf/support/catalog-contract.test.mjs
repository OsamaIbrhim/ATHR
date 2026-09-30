import assert from 'node:assert/strict'
import test from 'node:test'
import { requireCatalogProductMap } from './catalog-contract.mjs'

const sellableProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  catalog_version: 3,
  sku: 'ATHR-SMOKE-1',
  name_ar: 'منتج اختبار',
  selling_price: 100,
  unit_tax: 14,
}

test('catalog fixture IDs come from the API snapshot, not a broader database query', () => {
  const products = requireCatalogProductMap({
    products: [sellableProduct],
  })

  assert.deepEqual([...products.keys()], [sellableProduct.id])
  assert.equal(
    products.has('22222222-2222-4222-8222-222222222222'),
    false,
  )
})

test('catalog fixtures accept the same language fallback as the POS runtime', () => {
  const englishOnly = {
    ...sellableProduct,
    name_ar: null,
    name_en: 'Test product',
  }
  const products = requireCatalogProductMap({ products: [englishOnly] })
  assert.equal(products.get(englishOnly.id), englishOnly)
})

test('catalog fixtures reject malformed version 2 products before mutations run', () => {
  for (const product of [
    { ...sellableProduct, catalog_version: 1 },
    { ...sellableProduct, id: '' },
    { ...sellableProduct, sku: '' },
    { ...sellableProduct, name_ar: null, name_en: '' },
    { ...sellableProduct, selling_price: '100' },
    { ...sellableProduct, unit_tax: Number.NaN },
    { ...sellableProduct, selling_price: -1 },
    { ...sellableProduct, unit_tax: -1 },
  ]) {
    assert.throws(() => requireCatalogProductMap({ products: [product] }))
  }
})

test('catalog fixtures reject missing, empty, and duplicate product collections', () => {
  assert.throws(() => requireCatalogProductMap(null))
  assert.throws(() => requireCatalogProductMap({ products: [] }))
  assert.throws(() =>
    requireCatalogProductMap({
      products: [sellableProduct, { ...sellableProduct }],
    }),
  )
})
