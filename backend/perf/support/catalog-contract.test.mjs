import assert from 'node:assert/strict'
import test from 'node:test'
import { requireCatalogV2ProductMap } from './catalog-contract.mjs'

const sellableProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  catalog_version: 2,
  sku: 'ATHR-SMOKE-1',
  name_ar: 'منتج اختبار',
  selling_price: 100,
  unit_tax: 14,
}

test('catalog fixture IDs come from the API snapshot, not a broader database query', () => {
  const products = requireCatalogV2ProductMap({
    products: [sellableProduct],
  })

  assert.deepEqual([...products.keys()], [sellableProduct.id])
  assert.equal(
    products.has('22222222-2222-4222-8222-222222222222'),
    false,
  )
})

test('catalog fixtures reject malformed version 2 products before mutations run', () => {
  for (const product of [
    { ...sellableProduct, catalog_version: 1 },
    { ...sellableProduct, id: '' },
    { ...sellableProduct, sku: '' },
    { ...sellableProduct, name_ar: null },
    { ...sellableProduct, selling_price: '100' },
    { ...sellableProduct, unit_tax: Number.NaN },
  ]) {
    assert.throws(() => requireCatalogV2ProductMap({ products: [product] }))
  }
})

test('catalog fixtures reject missing, empty, and duplicate product collections', () => {
  assert.throws(() => requireCatalogV2ProductMap(null))
  assert.throws(() => requireCatalogV2ProductMap({ products: [] }))
  assert.throws(() =>
    requireCatalogV2ProductMap({
      products: [sellableProduct, { ...sellableProduct }],
    }),
  )
})
