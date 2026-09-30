import { describe, expect, it } from 'vitest'
import { clothingType } from './fixtures'
import { emptyVariantRow, type ProductFormState } from './form-model'
import { buildCreatePayload, parseProductAttributes } from './product-payload'
import { generateMatrix } from './variant-matrix'

const uomKg = { id: 'uom-kg', code: 'kg', name_ar: 'كيلو', name_en: 'Kg', precision: 3, is_active: true }

function state(over: Partial<ProductFormState> = {}): ProductFormState {
  const axisValues = { size: ['S', 'M'], color: ['red'] }
  const rows = generateMatrix(clothingType.attributes, axisValues, [], 'TS').rows.map(row => ({ ...row, cost: '40' }))
  return {
    name_en: 'T-shirt', name_ar: 'تيشيرت', product_type_id: clothingType.id, base_uom_id: '',
    productAttributes: { material: 'قطن', weight_g: '180' }, axisValues, variants: rows, ...over,
  }
}

describe('create payload', () => {
  it('copies product-level attributes into every variant with real types', () => {
    const built = buildCreatePayload(state(), clothingType)
    expect(built).toMatchObject({ ok: true })
    if (!('value' in built)) return
    expect(built.value.product_type_id).toBe('type-clothing')
    expect(built.value.variants).toHaveLength(2)
    expect(built.value.variants[0].attributes).toEqual({ material: 'قطن', weight_g: 180, size: 'S', color: 'red' })
    expect(built.value.variants[0]).not.toHaveProperty('base_uom_id')
  })

  it('drops empty product-level values and rejects invalid ones', () => {
    expect(parseProductAttributes(clothingType.attributes, { material: '', weight_g: '' })).toEqual({ ok: true, value: {} })
    expect(parseProductAttributes(clothingType.attributes, { weight_g: 'abc' })).toMatchObject({ ok: false })
    expect(parseProductAttributes(clothingType.attributes, { material: 'حرير' })).toMatchObject({ ok: false })
  })

  it('excludes inactive rows and applies the chosen unit', () => {
    const s = state()
    s.variants[1] = { ...s.variants[1], active: false }
    const built = buildCreatePayload(s, clothingType, uomKg)
    if (!('value' in built)) throw new Error('expected ok')
    expect(built.value.variants).toHaveLength(1)
    expect(built.value.variants[0].base_uom_id).toBe('uom-kg')
  })

  it('keeps the cost rules: explicit cost and confirmed zero', () => {
    const s = state()
    s.variants[0].cost = ''
    expect(buildCreatePayload(s, clothingType)).toMatchObject({ ok: false })
    s.variants[0].cost = '0'
    const zero = buildCreatePayload(s, clothingType)
    expect('errors' in zero && zero.errors.join()).toContain('صفرية')
    s.variants[0].zeroCostConfirmed = true
    expect(buildCreatePayload(s, clothingType)).toMatchObject({ ok: true })
  })

  it('rejects duplicate skus and barcodes and short names', () => {
    const s = state()
    s.variants[1].sku = s.variants[0].sku
    s.variants[0].barcodes = [{ code: '123', pack_qty: '1', kind: 'standard' }]
    s.variants[1].barcodes = [{ code: '123', pack_qty: '1', kind: 'standard' }]
    s.name_en = 'x'
    const result = buildCreatePayload(s, clothingType)
    expect('errors' in result && result.errors.length).toBe(3)
  })

  it('builds a simple product: no type, one variant, no attributes', () => {
    const row = { ...emptyVariantRow(), sku: 'MILK-1', cost: '12.5', barcodes: [{ code: '6221', pack_qty: '6', kind: 'standard' as const }] }
    const base = { name_en: 'Milk', name_ar: '', product_type_id: '', base_uom_id: '', productAttributes: {}, axisValues: {} }
    const built = buildCreatePayload({ ...base, variants: [row] }, null)
    if (!('value' in built)) throw new Error('expected ok')
    expect(built.value).toEqual({
      name_en: 'Milk',
      variants: [{ sku: 'MILK-1', attributes: {}, cost_price: 12.5, barcodes: [{ code: '6221', pack_qty: 6, kind: 'standard' }] }],
    })
    const two = buildCreatePayload({ ...base, variants: [row, { ...row, sku: 'MILK-2', barcodes: [] }] }, null)
    expect(two).toMatchObject({ ok: false })
  })

  it('rejects two rows with the same attribute combination', () => {
    const s = state()
    s.variants[1] = { ...s.variants[1], attributes: { ...s.variants[0].attributes } }
    expect(buildCreatePayload(s, clothingType)).toMatchObject({ ok: false })
  })
})
