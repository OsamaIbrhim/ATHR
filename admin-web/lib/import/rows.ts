import { FIELDS, type FieldKey, type Mapping } from './mapping'

/** A row as the backend reads it. `row_ref` is the row number in the Excel file (header counted). */
export interface ImportRow {
  row_ref: number
  sku?: string
  name?: string
  barcode?: string
  price?: string
  cost?: string
  opening_qty?: string
  unit?: string
  category?: string
  product_type?: string
}

const TARGET: Record<FieldKey, keyof ImportRow> = {
  name: 'name', sku: 'sku', barcode: 'barcode', price: 'price', cost: 'cost', qty: 'opening_qty',
  unit: 'unit', category: 'category', product_type: 'product_type',
}

/** Builds rows from the file body. `firstDataRow` is the 0-based file index of the first data row. */
export function buildImportRows(table: string[][], mapping: Mapping, firstDataRow: number): ImportRow[] {
  const rows: ImportRow[] = []
  for (let i = firstDataRow; i < table.length; i++) {
    const cells = table[i] ?? []
    if (cells.every(cell => !String(cell ?? '').trim())) continue
    const row: ImportRow = { row_ref: i + 1 }
    for (const field of FIELDS) {
      const column = mapping[field.key]
      if (column === null) continue
      const value = String(cells[column] ?? '').trim()
      if (value) (row as unknown as Record<string, string>)[TARGET[field.key]] = value
    }
    rows.push(row)
  }
  return rows
}

/** The identity the server uses: the SKU, or the first barcode when the SKU is empty. */
export function effectiveSku(row: ImportRow): string {
  if (row.sku) return row.sku.trim()
  return (row.barcode ?? '').split(/[;,]/)[0].trim()
}

export function barcodesOf(row: ImportRow): string[] {
  return (row.barcode ?? '').split(/[;,]/).map(code => code.trim()).filter(Boolean)
}

export const TEMPLATE_HEADERS = ['اسم المنتج', 'SKU', 'الباركود', 'سعر البيع', 'سعر الشراء', 'الكمية', 'الوحدة', 'التصنيف']
export const TEMPLATE_SAMPLE = ['شاي ليبتون 100 كيس', 'TEA-100', '6221234567890', '85', '70', '24', 'قطعة', 'مشروبات']
