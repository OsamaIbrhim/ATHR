import { parseScaleBarcode, type ScaleBarcodeReading } from '@athr/domain-core'
import { toCents } from '../money'
import type { ScanResult } from '../scan-types'
import { QUANTITY_SCALE, quantityToMilli, roundMilli, milliToQuantity } from '../quantity'
import { q } from './queries'
import { scaleBarcodeConfig } from './tenant-settings'

const SEARCH_LIMIT = 50

const PRODUCT_WITH_STOCK = `SELECT p.*, COALESCE(s.qty,0) AS qty
  FROM products p LEFT JOIN stock s ON s.variant_id=p.id`

// Each lookup below is a single indexed probe (barcodes PK, products_sku_idx).
const BARCODE_SQL = `SELECT p.*, COALESCE(s.qty,0) AS qty, b.pack_qty AS pack_qty
  FROM barcodes b
  JOIN products p ON p.id=b.variant_id
  LEFT JOIN stock s ON s.variant_id=p.id
  WHERE b.code=?`

const SCALE_PLU_SQL = `${BARCODE_SQL} AND b.kind='scale_plu'`

const SKU_SQL = `${PRODUCT_WITH_STOCK} WHERE p.sku=? LIMIT ${SEARCH_LIMIT}`

const TEXT_SEARCH_SQL = `${PRODUCT_WITH_STOCK}
  WHERE p.sku LIKE ? OR p.name_ar LIKE ? OR p.name_en LIKE ? OR p.label LIKE ?
  ORDER BY p.sku
  LIMIT ${SEARCH_LIMIT}`

export const SCAN_QUERIES = { BARCODE_SQL, SCALE_PLU_SQL, SKU_SQL, TEXT_SEARCH_SQL }

const notFound = (): ScanResult => ({ kind: 'search', qty: 1, products: [] })

/**
 * The quantity a scale label stands for. A weight label is the quantity
 * itself. A price label is what the customer pays for the whole item, so the
 * quantity is that price over the unit price *including* tax (the shelf price
 * the receipt shows), rounded half up to the unit's precision. Zero means the
 * label cannot be honoured.
 */
export function scaleQuantity(
  reading: ScaleBarcodeReading,
  product: { selling_price_minor_units?: unknown; unit_tax_minor_units?: unknown; uom_precision?: unknown },
): number {
  const precision = Math.min(QUANTITY_SCALE, Math.max(0, Number(product.uom_precision) || 0))
  if (reading.kind === 'weight') {
    return milliToQuantity(roundMilli(quantityToMilli(reading.value), precision))
  }
  const grossCents = Number(product.selling_price_minor_units || 0) + Number(product.unit_tax_minor_units || 0)
  if (!(grossCents > 0)) return 0
  const labelCents = toCents(reading.value)
  const milli = Math.floor((labelCents * 1000 * 2 + grossCents) / (grossCents * 2))
  return milliToQuantity(roundMilli(milli, precision))
}

function withoutPackQty({ pack_qty: _packQty, ...product }: Record<string, any>) {
  return product
}

/**
 * Resolves what the cashier typed or scanned: exact barcode (its pack size is
 * the quantity) -> exact SKU -> scale label (weight or price) -> text search.
 */
export function scan(rawTerm: unknown): ScanResult {
  const term = String(rawTerm || '').trim()
  if (!term) return notFound()

  const [barcode] = q(BARCODE_SQL, [term])
  if (barcode) {
    return { kind: 'barcode', qty: Number(barcode.pack_qty), products: [withoutPackQty(barcode)] }
  }

  const bySku = q(SKU_SQL, [term])
  if (bySku.length) return { kind: 'sku', qty: 1, products: bySku }

  const reading = parseScaleBarcode(term, scaleBarcodeConfig())
  if (reading) {
    const [labelled] = q(SCALE_PLU_SQL, [reading.plu])
    const qty = labelled ? scaleQuantity(reading, labelled) : 0
    if (labelled && qty > 0) return { kind: 'scale', qty, products: [withoutPackQty(labelled)] }
  }

  const like = `%${term}%`
  return { kind: 'search', qty: 1, products: q(TEXT_SEARCH_SQL, [like, like, like, like]) }
}
