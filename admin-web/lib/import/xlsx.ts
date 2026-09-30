/**
 * Reads the cells of an .xlsx workbook without a dependency: a ZIP container
 * (stored or deflated entries) holding workbook.xml, its relationships, the
 * shared strings and one XML per sheet. Values come back as text.
 */

export interface SheetData { name: string; rows: string[][] }
export class XlsxError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

interface ZipEntry { name: string; method: number; compressedSize: number; offset: number }

function listEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new XlsxError('not a zip')
  const count = u16(bytes, eocd + 10)
  let pos = u32(bytes, eocd + 16)
  const entries = new Map<string, ZipEntry>()
  for (let n = 0; n < count; n++) {
    if (u32(bytes, pos) !== 0x02014b50) throw new XlsxError('bad central directory')
    const method = u16(bytes, pos + 10)
    const compressedSize = u32(bytes, pos + 20)
    const nameLength = u16(bytes, pos + 28)
    const extraLength = u16(bytes, pos + 30)
    const commentLength = u16(bytes, pos + 32)
    const offset = u32(bytes, pos + 42)
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength))
    entries.set(name, { name, method, compressedSize, offset })
    pos += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  if (u32(bytes, entry.offset) !== 0x04034b50) throw new XlsxError('bad local header')
  const start = entry.offset + 30 + u16(bytes, entry.offset + 26) + u16(bytes, entry.offset + 28)
  const raw = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return new TextDecoder().decode(raw)
  if (entry.method === 8) return new TextDecoder().decode(await inflateRaw(raw))
  throw new XlsxError(`unsupported compression ${entry.method}`)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

const textOf = (xml: string) => {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, '')
  let out = ''
  for (const m of cleaned.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1]
  return decodeXml(out)
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
}

/** "C5" gives column index 2. */
export function columnIndex(ref: string): number {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0].toUpperCase() ?? 'A'
  let index = 0
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

/** Excel stores big integers (13-digit barcodes) as 6.2212345678901E+12; give plain digits back. */
export function plainNumber(raw: string): string {
  if (!/[eE]/.test(raw)) return raw
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
  return String(value)
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  let nextRow = 0
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowRef = attr(rowMatch[1], 'r')
    const rowIndex = rowRef ? parseInt(rowRef, 10) - 1 : nextRow
    nextRow = rowIndex + 1
    const cells: string[] = []
    let nextCol = 0
    for (const cell of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cell[1], 'r')
      const col = ref ? columnIndex(ref) : nextCol
      nextCol = col + 1
      const type = attr(cell[1], 't')
      const body = cell[2] ?? ''
      let value = ''
      if (type === 'inlineStr') value = textOf(body)
      else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1]
        if (v !== undefined) {
          if (type === 's') value = shared[parseInt(v, 10)] ?? ''
          else if (type === 'str' || type === 'e') value = decodeXml(v)
          else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE'
          else value = plainNumber(v)
        }
      }
      while (cells.length < col) cells.push('')
      cells[col] = value
    }
    while (rows.length < rowIndex) rows.push([])
    rows[rowIndex] = cells
  }
  return rows
}

const normalizeTarget = (target: string) => (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`)

export async function readXlsx(bytes: Uint8Array): Promise<SheetData[]> {
  const entries = listEntries(bytes)
  const read = async (name: string) => {
    const entry = entries.get(name)
    return entry ? readEntry(bytes, entry) : null
  }
  const workbook = await read('xl/workbook.xml')
  if (!workbook) throw new XlsxError('no workbook')
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? ''
  const targets = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], 'Id'); const target = attr(m[1], 'Target')
    if (id && target) targets.set(id, normalizeTarget(target))
  }
  const sharedXml = await read('xl/sharedStrings.xml')
  const shared = sharedXml ? Array.from(sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), m => textOf(m[1])) : []
  const sheets: SheetData[] = []
  let order = 0
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    order += 1
    const state = attr(m[1], 'state')
    if (state === 'hidden' || state === 'veryHidden') continue
    const name = decodeXml(attr(m[1], 'name') ?? `Sheet${order}`)
    const rid = attr(m[1], 'r:id')
    const path = (rid && targets.get(rid)) || `xl/worksheets/sheet${order}.xml`
    const xml = await read(path)
    if (xml === null) continue
    sheets.push({ name, rows: parseSheet(xml, shared) })
  }
  if (!sheets.length) throw new XlsxError('no sheets')
  return sheets
}
