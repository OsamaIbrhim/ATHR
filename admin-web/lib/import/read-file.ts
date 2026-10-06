import { decodeCsvBytes, parseCsv } from './csv'
import { readXlsx, XlsxError, type SheetData } from './xlsx'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_FILE_ROWS = 10_000
export const ACCEPT = '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type ReadFailure = 'type' | 'size' | 'empty' | 'corrupt'
export class ReadFileError extends Error {
  constructor(public reason: ReadFailure) { super(reason) }
}

export interface ParsedFile {
  name: string
  size: number
  kind: 'xlsx' | 'csv'
  sheets: SheetData[]
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b

/** First sheet that has at least one non-empty cell. */
export const firstFilledSheet = (sheets: SheetData[]) =>
  Math.max(0, sheets.findIndex(sheet => sheet.rows.some(row => row.some(cell => String(cell).trim()))))

export async function readTableFile(file: File): Promise<ParsedFile> {
  const lower = file.name.toLowerCase()
  const kind = lower.endsWith('.xlsx') ? 'xlsx' : lower.endsWith('.csv') || file.type === 'text/csv' ? 'csv' : null
  if (!kind) throw new ReadFileError('type')
  if (file.size > MAX_FILE_BYTES) throw new ReadFileError('size')
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const sheets: SheetData[] = kind === 'xlsx'
      ? (isZip(bytes) ? await readXlsx(bytes) : (() => { throw new XlsxError('not xlsx') })())
      : [{ name: file.name, rows: parseCsv(decodeCsvBytes(bytes)) }]
    return { name: file.name, size: file.size, kind, sheets }
  } catch (error) {
    if (error instanceof ReadFileError) throw error
    throw new ReadFileError('corrupt')
  }
}

/** Whether the first row looks like headers: mostly non-numeric text. */
export function looksLikeHeader(row: string[] | undefined): boolean {
  if (!row?.length) return false
  const filled = row.map(c => String(c).trim()).filter(Boolean)
  if (!filled.length) return false
  return filled.filter(c => !/^[\d.,٠-٩\s-]+$/.test(c)).length / filled.length >= 0.6
}
