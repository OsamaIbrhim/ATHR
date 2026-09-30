import { describe, expect, it } from 'vitest'
import { emptyAttribute, normalizeAttributeDefinitions, validateAttributeDefinitions, validateProductType } from './attribute-schema'
import { clothingType } from './fixtures'

const attr = (over = {}) => ({ ...emptyAttribute(), key: 'size', label_ar: 'المقاس', label_en: 'Size', ...over })

describe('attribute validation (mirrors backend product-type-schema)', () => {
  it('accepts the clothing preset shape', () => {
    expect(validateAttributeDefinitions(clothingType.attributes)).toEqual([])
  })

  it('rejects bad keys and duplicates', () => {
    expect(validateAttributeDefinitions([attr({ key: 'Size' })])).toHaveLength(1)
    expect(validateAttributeDefinitions([attr({ key: '1size' })])).toHaveLength(1)
    expect(validateAttributeDefinitions([attr({ key: 'a'.repeat(41) })])).toHaveLength(1)
    expect(validateAttributeDefinitions([attr(), attr()]).join()).toContain('مكرر')
  })

  it('requires both labels', () => {
    expect(validateAttributeDefinitions([attr({ label_en: ' ' })])).toHaveLength(1)
    expect(validateAttributeDefinitions([attr({ label_ar: '' })])).toHaveLength(1)
  })

  it('requires options for a select and rejects duplicate options', () => {
    expect(validateAttributeDefinitions([attr({ kind: 'select', options: [] })])).toHaveLength(1)
    expect(validateAttributeDefinitions([attr({ kind: 'select', options: ['a', 'a'] })])).toHaveLength(1)
    expect(validateAttributeDefinitions([attr({ kind: 'select', options: ['a', 'b'] })])).toEqual([])
  })

  it('caps the list at 20 attributes', () => {
    const many = Array.from({ length: 21 }, (_, i) => attr({ key: `k${i}` }))
    expect(validateAttributeDefinitions(many).join()).toContain('20')
  })

  it('needs both type names', () => {
    expect(validateProductType({ name_ar: '', name_en: 'X', attributes: [] })).toHaveLength(1)
    expect(validateProductType({ name_ar: 'س', name_en: 'X', attributes: [] })).toEqual([])
  })

  it('drops options from non-select attributes before sending', () => {
    const [normalized] = normalizeAttributeDefinitions([attr({ kind: 'text', options: ['x'], key: ' size ' })])
    expect(normalized).not.toHaveProperty('options')
    expect(normalized.key).toBe('size')
  })
})
