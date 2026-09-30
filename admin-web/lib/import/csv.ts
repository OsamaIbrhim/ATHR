/** Minimal RFC-4180 CSV parser: quotes, doubled quotes, CRLF/LF, BOM, delimiter sniffing. */

export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  let best = ','
  let bestCount = 0
  for (const candidate of [',', ';', '\t']) {
    const count = firstLine.split(candidate).length - 1
    if (count > bestCount) { best = candidate; bestCount = count }
  }
  return best
}

export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const sep = delimiter ?? sniffDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let touched = false
  const endCell = () => { row.push(cell); cell = ''; touched = true }
  const endRow = () => {
    endCell()
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []; touched = false
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell === '') { quoted = true; touched = true }
    else if (ch === sep) endCell()
    else if (ch === '\n') endRow()
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow() }
    else cell += ch
  }
  if (touched || cell !== '' || row.length) endRow()
  return rows
}

/** UTF-8 when valid, otherwise Windows-1256 (what old Arabic Excel exports to CSV). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1256').decode(bytes)
  }
}

/** One CSV cell, quoted when it needs to be; a leading = + @ (or a non-numeric -) is neutralised against spreadsheet formulas. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+@]/.test(text) || (/^-/.test(text) && !/^-\d+(\.\d+)?$/.test(text))) text = `'${text}`
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return `﻿${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
