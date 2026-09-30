import { describe, expect, it } from 'vitest'
import { csvCell, decodeCsvBytes, parseCsv, sniffDelimiter, toCsv } from './csv'

describe('parseCsv', () => {
  it('parses quotes, doubled quotes, embedded commas and newlines', () => {
    const rows = parseCsv('name,price\r\n"شاي, ليبتون",85\r\n"He said ""hi""",10\r\n"two\nlines",5\r\n')
    expect(rows).toEqual([['name', 'price'], ['شاي, ليبتون', '85'], ['He said "hi"', '10'], ['two\nlines', '5']])
  })
  it('skips a BOM and blank lines, and keeps empty cells', () => {
    expect(parseCsv('﻿a,b,c\n\n1,,3')).toEqual([['a', 'b', 'c'], ['1', '', '3']])
  })
  it('sniffs semicolons and tabs', () => {
    expect(sniffDelimiter('a;b;c')).toBe(';')
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('handles a last line without a newline and old Mac CR endings', () => {
    expect(parseCsv('a,b\r1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('decodeCsvBytes', () => {
  it('reads UTF-8 and falls back to Windows-1256', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('شاي'))).toBe('شاي')
    // "شاي" in windows-1256: D4 C7 ED
    expect(decodeCsvBytes(new Uint8Array([0xd4, 0xc7, 0xed]))).toBe('شاي')
  })
})

describe('csv output', () => {
  it('quotes where needed and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('-5')).toBe('-5')
    expect(toCsv([['a', 'b'], [1, null]])).toBe('﻿a,b\r\n1,\r\n')
  })
})
