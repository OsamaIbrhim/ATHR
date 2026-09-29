import { describe, expect, it } from 'vitest'
import { clothingType } from './fixtures'
import { cartesian, generateMatrix, MAX_VARIANTS, rebaseSkus, suggestSku } from './variant-matrix'
import { variantLabel, variantTitle } from './variant-label'

const defs = clothingType.attributes

describe('variant label preview', () => {
  it('joins axis values in the type order and ignores non-axis attributes', () => {
    expect(variantLabel(defs, { color: 'أسود', size: 'L', material: 'قطن' })).toBe('L · أسود')
    expect(variantLabel(defs, {})).toBe('')
  })

  it('builds a list title from the product name and label', () => {
    expect(variantTitle({ label: 'L · أسود', product: { name_ar: 'قميص', name_en: 'Shirt' } })).toBe('قميص · L · أسود')
    expect(variantTitle({ label: '', product: { name_en: 'Milk' } })).toBe('Milk')
  })
})

describe('matrix generation', () => {
  it('expands two axes into all combinations', () => {
    const combos = cartesian(defs, { size: ['S', 'M', 'L'], color: ['أسود', 'أبيض'] })
    expect(combos).toHaveLength(6)
    expect(combos[0]).toEqual({ size: 'S', color: 'أسود' })
  })

  it('returns nothing until every axis has a value', () => {
    expect(cartesian(defs, { size: ['S'] })).toEqual([])
  })

  it('keeps typed data of surviving rows when the axes change', () => {
    const first = generateMatrix(defs, { size: ['S'], color: ['red'] }, [], 'TS')
    expect(first.rows[0].sku).toBe('TS-S-RED')
    const edited = [{ ...first.rows[0], sku: 'CUSTOM', cost: '50' }]
    const second = generateMatrix(defs, { size: ['S', 'M'], color: ['red'] }, edited, 'TS')
    expect(second.rows.map(row => row.sku)).toEqual(['CUSTOM', 'TS-M-RED'])
    expect(second.rows[0].cost).toBe('50')
  })

  it('keeps server rows that fell out of the matrix so they can be deactivated', () => {
    const persisted = { ...generateMatrix(defs, { size: ['S'], color: ['red'] }, []).rows[0], id: 'v1' }
    const next = generateMatrix(defs, { size: ['M'], color: ['red'] }, [persisted])
    expect(next.rows.map(row => row.id)).toEqual([undefined, 'v1'])
  })

  it('coerces number axes and drops empty values', () => {
    const numeric = [{ key: 'volume', label_ar: 'الحجم', label_en: 'Volume', kind: 'number' as const, axis: true }]
    expect(cartesian(numeric, { volume: ['250', ' ', 'x'] })).toEqual([{ volume: 250 }])
  })

  it('is one row for a type without axes', () => {
    expect(generateMatrix([], {}, []).rows).toHaveLength(1)
  })

  it('truncates beyond the backend limit', () => {
    const many = Array.from({ length: 600 }, (_, i) => String(i))
    const result = generateMatrix([defs[0]], { size: many }, [])
    expect(result.rows).toHaveLength(MAX_VARIANTS)
    expect(result.truncated).toBe(true)
  })

  it('re-bases suggested skus but keeps typed and saved ones', () => {
    const rows = generateMatrix(defs, { size: ['S', 'M'], color: ['red'] }, []).rows
    rows[1] = { ...rows[1], sku: 'MINE' }
    const next = rebaseSkus(rows, '', 'TS', defs)
    expect(next.map(row => row.sku)).toEqual(['TS-S-RED', 'MINE'])
    expect(rebaseSkus([{ ...rows[0], id: 'v1' }], '', 'TS', defs)[0].sku).toBe('S-RED')
  })

  it('suggests a sku from base and axis values', () => {
    expect(suggestSku('', { size: 'xl', color: 'red' }, defs)).toBe('XL-RED')
  })

  it('keeps suggested skus ASCII and stable for non-latin values', () => {
    const sku = suggestSku('TS', { size: 'XL', color: 'أزرق فاتح' }, defs)
    expect(sku).toMatch(/^TS-XL-C[0-9A-Z]{4}$/)
    expect(suggestSku('TS', { size: 'XL', color: 'أزرق فاتح' }, defs)).toBe(sku)
    expect(suggestSku('TS', { size: 'XL', color: 'أسود' }, defs)).not.toBe(sku)
  })
})
