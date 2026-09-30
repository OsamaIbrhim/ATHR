import { toCsv } from './csv'
import type { RowResult } from './runner'
import { problemText } from './runner'
import { TEMPLATE_HEADERS, TEMPLATE_SAMPLE } from './rows'
import { buildXlsx } from './xlsx-write'

export function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadTemplate(kind: 'xlsx' | 'csv') {
  const rows = [TEMPLATE_HEADERS, TEMPLATE_SAMPLE]
  if (kind === 'csv') downloadBlob('athr-products-template.csv', toCsv(rows), 'text/csv;charset=utf-8')
  else downloadBlob('athr-products-template.xlsx', buildXlsx(rows, 'المنتجات') as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

/**
 * The errors file: the original columns of each problem row, plus "رقم الصف" and
 * "سبب الخطأ", so the owner fixes the same file and uploads it again.
 */
export function errorsFileRows(table: string[][], hasHeader: boolean, results: RowResult[]): string[][] {
  const width = table.reduce((w, r) => Math.max(w, r.length), 0)
  const header = hasHeader ? [...(table[0] ?? [])] : Array.from({ length: width }, (_, i) => `عمود ${i + 1}`)
  while (header.length < width) header.push('')
  const out: string[][] = [[...header, 'رقم الصف', 'سبب الخطأ']]
  for (const r of results) {
    if (r.status === 'ready' || r.status === 'created') continue
    const cells = [...(table[r.row_ref - 1] ?? [])]
    while (cells.length < width) cells.push('')
    out.push([...cells, String(r.row_ref), problemText(r)])
  }
  return out
}

export const downloadErrorsFile = (table: string[][], hasHeader: boolean, results: RowResult[]) =>
  downloadBlob('athr-import-errors.csv', toCsv(errorsFileRows(table, hasHeader, results)), 'text/csv;charset=utf-8')
