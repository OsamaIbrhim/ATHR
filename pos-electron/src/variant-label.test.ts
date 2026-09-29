import { describe, expect, it } from 'vitest'
import { variantLabel } from './variant-label'

describe('variant label', () => {
  it('prefers the generic label', () => {
    expect(variantLabel({ label: ' L · أسود ', size: 'M', color: 'red' })).toBe('L · أسود')
  })

  it('derives the label from size and color of POS <= 1.5 data', () => {
    expect(variantLabel({ size: 'M', color: 'Blue' })).toBe('M · Blue')
    expect(variantLabel({ size: 'M' })).toBe('M')
    expect(variantLabel({ color: 'Blue', size: null })).toBe('Blue')
    expect(variantLabel({})).toBe('')
  })
})
