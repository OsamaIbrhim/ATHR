// @vitest-environment node
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { columnIndex, plainNumber, readXlsx } from './xlsx'

function crc32(buf: Buffer): number {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

/** A tiny ZIP writer: method 0 (stored) or 8 (deflate) per entry. */
function zip(files: Array<{ name: string; data: string; deflate?: boolean }>): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const raw = Buffer.from(file.data, 'utf8')
    const body = file.deflate ? deflateRawSync(raw) : raw
    const name = Buffer.from(file.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(file.deflate ? 8 : 0, 8)
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
    central.writeUInt16LE(file.deflate ? 8 : 0, 10); central.writeUInt32LE(crc32(raw), 16)
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, ...centrals, end]))
}

const workbook = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="المنتجات" sheetId="1" r:id="rId1"/><sheet name="مخفية" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Two" sheetId="3" r:id="rId3"/></sheets></workbook>`
const rels = `<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="x" Target="/xl/worksheets/sheet9.xml"/></Relationships>`
const shared = `<sst><si><t>اسم</t></si><si><r><t>شاي </t></r><r><t>&amp; سكر</t></r></si><si><t>سعر</t></si></sst>`
const sheet1 = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>inline</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>12.5</v></c><c r="C2"><v>6.22123456789E+12</v></c><c r="D2" t="b"><v>1</v></c></row>
<row r="4"><c r="A4" t="str"><v>a &lt; b</v></c></row>
</sheetData></worksheet>`
const sheet9 = `<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`

describe('readXlsx', () => {
  const files = [
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/sharedStrings.xml', data: shared, deflate: true },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1, deflate: true },
    { name: 'xl/worksheets/sheet2.xml', data: sheet9 },
    { name: 'xl/worksheets/sheet9.xml', data: sheet9 },
  ]

  it('reads stored and deflated entries, shared and inline strings, gaps and hidden sheets', async () => {
    const sheets = await readXlsx(zip(files))
    expect(sheets.map(s => s.name)).toEqual(['المنتجات', 'Two'])
    expect(sheets[0].rows[0]).toEqual(['اسم', 'سعر', '', 'inline'])
    expect(sheets[0].rows[1]).toEqual(['شاي & سكر', '12.5', '6221234567890', 'TRUE'])
    expect(sheets[0].rows[2]).toEqual([])
    expect(sheets[0].rows[3]).toEqual(['a < b'])
    expect(sheets[1].rows[0]).toEqual(['7'])
  })

  it('rejects a file that is not a workbook', async () => {
    await expect(readXlsx(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
    await expect(readXlsx(zip([{ name: 'hello.txt', data: 'x' }]))).rejects.toThrow()
  })
})

describe('helpers', () => {
  it('converts column letters', () => {
    expect(columnIndex('A1')).toBe(0)
    expect(columnIndex('AB7')).toBe(27)
  })
  it('expands scientific notation of big integers', () => {
    expect(plainNumber('6.2212345678900001E+12')).toBe('6221234567890')
    expect(plainNumber('12.5')).toBe('12.5')
  })
})
