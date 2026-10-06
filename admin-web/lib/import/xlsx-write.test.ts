// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildXlsx, crc32 } from './xlsx-write'
import { readXlsx } from './xlsx'

describe('buildXlsx', () => {
  it('round-trips through the reader, including Arabic, XML characters and empty cells', async () => {
    const rows = [['اسم المنتج', 'SKU', 'سعر'], ['شاي & "ليبتون" <كبير>', 'TEA-1', ''], ['', '', '85.5']]
    const sheets = await readXlsx(buildXlsx(rows, 'المنتجات'))
    expect(sheets).toHaveLength(1)
    expect(sheets[0].name).toBe('المنتجات')
    expect(sheets[0].rows).toEqual([['اسم المنتج', 'SKU', 'سعر'], ['شاي & "ليبتون" <كبير>', 'TEA-1'], ['', '', '85.5']])
  })
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})
