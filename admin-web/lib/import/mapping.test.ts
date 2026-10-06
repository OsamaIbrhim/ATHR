import { describe, expect, it } from 'vitest'
import { autoMap, duplicateColumns, missingFields, normalizeHeader, sampleColumns } from './mapping'
import { buildImportRows } from './rows'

describe('autoMap', () => {
  it('maps Arabic and English headers by synonym', () => {
    const headers = ['الصنف', 'كود', 'باركود', 'السعر', 'سعر الشراء', 'الكمية', 'الوحدة', 'التصنيف']
    const m = autoMap(headers, [['شاي', 'T1', '6221234567890', '85', '70', '24', 'قطعة', 'مشروبات']])
    expect(m).toMatchObject({ name: 0, sku: 1, barcode: 2, price: 3, cost: 4, qty: 5, unit: 6, category: 7, product_type: null })
    const en = autoMap(['Item Name', 'SKU', 'Barcode', 'Price', 'Cost', 'Qty'], [])
    expect(en).toMatchObject({ name: 0, sku: 1, barcode: 2, price: 3, cost: 4, qty: 5 })
  })
  it('prefers the exact header and never uses a column twice', () => {
    const m = autoMap(['سعر البيع', 'سعر الشراء', 'اسم'], [])
    expect(m.price).toBe(0)
    expect(m.cost).toBe(1)
    const used = Object.values(m).filter(v => v !== null)
    expect(new Set(used).size).toBe(used.length)
  })
  it('folds Arabic letter variants and diacritics', () => {
    expect(normalizeHeader('  الكَمِّيَّة ')).toBe('الكميه')
    expect(normalizeHeader('أسم_الصنف')).toBe('اسم الصنف')
  })
  it('without headers, finds the barcode by shape and the name by text width', () => {
    const rows = [['شاي ليبتون كبير', '6221234567890', '85'], ['سكر', '6221234567891', '30'], ['أرز مصري', '6221234567892', '42']]
    const m = autoMap(null, rows)
    expect(m.barcode).toBe(1)
    expect(m.name).toBe(0)
    expect(m.price).toBeNull()
  })
  it('the plain word "النوع" is a category, not a product type', () => {
    expect(autoMap(['اسم', 'النوع'], []).category).toBe(1)
    expect(autoMap(['اسم', 'نوع المنتج'], []).product_type).toBe(1)
  })
})

describe('mapping rules', () => {
  it('reports what is still required', () => {
    expect(missingFields(autoMap(['اسم'], []))).toEqual(['SKU أو الباركود', 'سعر البيع'])
    expect(missingFields({ name: 0, sku: null, barcode: 2, price: 3, cost: null, qty: null, unit: null, category: null, product_type: null })).toEqual([])
  })
  it('flags two fields on one column', () => {
    const dupes = duplicateColumns({ name: 0, sku: 0, barcode: null, price: 1, cost: null, qty: null, unit: null, category: null, product_type: null })
    expect([...dupes]).toEqual(['sku'])
  })
  it('samples the first non-empty values of each column', () => {
    expect(sampleColumns([['a', ''], ['', 'x'], ['b', 'y']], 2)).toEqual([['a', 'b'], ['x', 'y']])
  })
})

describe('buildImportRows', () => {
  it('numbers rows as in the file, skips blank rows and empty cells', () => {
    const table = [['اسم', 'كود', 'سعر'], ['شاي', 'T1', '85'], ['', '', ''], ['سكر', '', '30']]
    const rows = buildImportRows(table, { name: 0, sku: 1, barcode: null, price: 2, cost: null, qty: null, unit: null, category: null, product_type: null }, 1)
    expect(rows).toEqual([{ row_ref: 2, name: 'شاي', sku: 'T1', price: '85' }, { row_ref: 4, name: 'سكر', price: '30' }])
  })
})
