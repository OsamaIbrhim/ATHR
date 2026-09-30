import { toWesternDigits } from '../format'

export type FieldKey = 'name' | 'sku' | 'barcode' | 'price' | 'cost' | 'qty' | 'unit' | 'category' | 'product_type'

export interface FieldSpec {
  key: FieldKey
  label: string
  /** `name`, `price` are required; `sku`/`barcode` are required as a pair (see missingFields). */
  required: boolean
  hint?: string
  synonyms: string[]
}

export const FIELDS: FieldSpec[] = [
  { key: 'name', label: 'اسم المنتج', required: true, synonyms: ['اسم', 'اسم المنتج', 'اسم الصنف', 'الصنف', 'المنتج', 'البيان', 'name', 'product', 'product name', 'item', 'item name', 'description'] },
  { key: 'sku', label: 'SKU (كود الصنف)', required: false, hint: 'الأصناف التي لها نفس SKU موجودة بالفعل لن تتغير.', synonyms: ['sku', 'كود', 'كود الصنف', 'رمز', 'رقم الصنف', 'كود المنتج', 'code', 'item code', 'product code'] },
  { key: 'barcode', label: 'الباركود', required: false, hint: 'لأكثر من باركود للصنف افصل بينها بـ ؛ أو ,', synonyms: ['باركود', 'الباركود', 'بار كود', 'barcode', 'bar code', 'ean', 'upc', 'gtin'] },
  { key: 'price', label: 'سعر البيع', required: true, hint: 'بالجنيه المصري', synonyms: ['سعر البيع', 'السعر', 'سعر', 'سعر المستهلك', 'سعر الجمهور', 'price', 'sale price', 'selling price', 'retail price'] },
  { key: 'cost', label: 'سعر الشراء (التكلفة)', required: false, hint: 'مطلوب إذا أدخلت كمية', synonyms: ['التكلفة', 'تكلفة', 'سعر الشراء', 'سعر التكلفة', 'سعر الجملة', 'cost', 'purchase price', 'buy price', 'cost price'] },
  { key: 'qty', label: 'الكمية الافتتاحية', required: false, hint: 'تُسجَّل في الفرع المختار', synonyms: ['الكمية', 'كمية', 'الرصيد', 'رصيد', 'المخزون', 'الكمية الافتتاحية', 'رصيد افتتاحي', 'qty', 'quantity', 'stock', 'opening qty', 'on hand'] },
  { key: 'unit', label: 'الوحدة', required: false, hint: 'قطعة، كجم، … الافتراضي: قطعة', synonyms: ['الوحدة', 'وحدة', 'وحدة القياس', 'unit', 'uom'] },
  { key: 'category', label: 'التصنيف', required: false, hint: 'يُنشأ تلقائيًا إن لم يكن موجودًا.', synonyms: ['التصنيف', 'تصنيف', 'الفئة', 'فئة', 'القسم', 'قسم', 'النوع', 'المجموعة', 'category', 'group', 'department'] },
  { key: 'product_type', label: 'نوع المنتج', required: false, hint: 'يجب أن يكون نوعًا موجودًا، وإلا يُرفض الصف.', synonyms: ['نوع المنتج', 'نوع الصنف', 'product type', 'type'] },
]

export type Mapping = Record<FieldKey, number | null>

export const emptyMapping = (): Mapping => ({ name: null, sku: null, barcode: null, price: null, cost: null, qty: null, unit: null, category: null, product_type: null })

/** Lower-cases, folds Arabic letter variants, drops diacritics/tatweel/punctuation. */
export function normalizeHeader(text: string): string {
  return toWesternDigits(String(text ?? ''))
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_\-./\\:()[\]*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function headerScore(header: string, synonyms: string[]): number {
  const h = normalizeHeader(header)
  if (!h) return 0
  let best = 0
  for (const synonym of synonyms) {
    const s = normalizeHeader(synonym)
    if (h === s) return 100
    if (h.includes(s) && s.length >= 3) best = Math.max(best, 50 + s.length)
  }
  return best
}

const isDigits = (value: string) => /^\d{8,14}$/.test(value.trim())
const isNumeric = (value: string) => /^-?\d+([.,]\d+)?$/.test(toWesternDigits(value).trim())

/** Indices of the first up-to-`limit` non-empty values of each column. */
export function sampleColumns(rows: string[][], limit = 3): string[][] {
  const width = rows.reduce((w, row) => Math.max(w, row.length), 0)
  const out: string[][] = Array.from({ length: width }, () => [])
  for (const row of rows) {
    for (let c = 0; c < width; c++) {
      const v = (row[c] ?? '').trim()
      if (v && out[c].length < limit) out[c].push(v)
    }
  }
  return out
}

/**
 * Picks a file column for each ATHR field: by header synonym first (exact beats
 * partial), then, for the fields still open, by the shape of the values
 * (8-14 digit numbers are barcodes, the widest text column is the name).
 * A column is never used twice.
 */
export function autoMap(headers: string[] | null, dataRows: string[][]): Mapping {
  const mapping = emptyMapping()
  const used = new Set<number>()
  const width = Math.max(headers?.length ?? 0, dataRows.reduce((w, r) => Math.max(w, r.length), 0))
  if (headers) {
    const candidates: { key: FieldKey; column: number; score: number }[] = []
    for (const field of FIELDS) {
      for (let c = 0; c < headers.length; c++) {
        const score = headerScore(headers[c], field.synonyms)
        if (score > 0) candidates.push({ key: field.key, column: c, score })
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.column - b.column)
    for (const { key, column } of candidates) {
      if (mapping[key] !== null || used.has(column)) continue
      mapping[key] = column
      used.add(column)
    }
  }
  const values = (c: number) => dataRows.map(row => (row[c] ?? '').trim()).filter(Boolean)
  if (mapping.barcode === null) {
    for (let c = 0; c < width; c++) {
      if (used.has(c)) continue
      const v = values(c)
      if (v.length >= 2 && v.filter(isDigits).length / v.length >= 0.8) { mapping.barcode = c; used.add(c); break }
    }
  }
  if (mapping.name === null) {
    let best = -1; let bestScore = 0
    for (let c = 0; c < width; c++) {
      if (used.has(c)) continue
      const v = values(c)
      if (!v.length) continue
      const textShare = v.filter(x => !isNumeric(x)).length / v.length
      const score = textShare >= 0.8 ? v.reduce((s, x) => s + x.length, 0) / v.length : 0
      if (score > bestScore) { best = c; bestScore = score }
    }
    if (best >= 0) { mapping.name = best; used.add(best) }
  }
  return mapping
}

/** Fields mapped to the same file column (the later one is the conflict). */
export function duplicateColumns(mapping: Mapping): Set<FieldKey> {
  const seen = new Map<number, FieldKey>()
  const dupes = new Set<FieldKey>()
  for (const field of FIELDS) {
    const column = mapping[field.key]
    if (column === null) continue
    if (seen.has(column)) dupes.add(field.key)
    else seen.set(column, field.key)
  }
  return dupes
}

/** Names of the required things not mapped yet (name, price, and one of SKU/barcode). */
export function missingFields(mapping: Mapping): string[] {
  const missing: string[] = []
  if (mapping.name === null) missing.push('اسم المنتج')
  if (mapping.sku === null && mapping.barcode === null) missing.push('SKU أو الباركود')
  if (mapping.price === null) missing.push('سعر البيع')
  return missing
}
