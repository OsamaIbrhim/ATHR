import { describe, expect, it } from 'vitest'
import { toCatalogProduct } from './product-row'

describe('catalog product for the renderer', () => {
  it('turns stored minor units into decimal price and tax and hides the columns', () => {
    const product = toCatalogProduct({
      id: 'p1',
      sku: 'S',
      selling_price_minor_units: 1999,
      unit_tax_minor_units: 280,
    })
    expect(product).toEqual({ id: 'p1', sku: 'S', selling_price: 19.99, unit_tax: 2.8 })
  })

  it('treats missing amounts as zero', () => {
    expect(toCatalogProduct({ id: 'p1' })).toMatchObject({ selling_price: 0, unit_tax: 0 })
  })
})
