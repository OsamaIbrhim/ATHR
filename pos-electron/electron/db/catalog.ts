import { requiresFullCatalogRefresh } from '../catalog-format'
import { get, getMeta, q, setMeta } from './queries'

const SEARCH_LIMIT = 50

const PRODUCT_WITH_QTY = `SELECT p.*, COALESCE(s.qty,0) AS qty
  FROM products p LEFT JOIN stock s ON s.variant_id=p.id`

// Exact barcode / SKU hit: served by the three single-column indexes.
const EXACT_MATCH_SQL = `${PRODUCT_WITH_QTY}
  WHERE p.barcode_ean13=? OR p.barcode_internal=? OR p.sku=?
  ORDER BY CASE WHEN p.barcode_ean13=? OR p.barcode_internal=? THEN 0 ELSE 1 END, p.sku
  LIMIT ${SEARCH_LIMIT}`

// Typed search fallback (substring), only when nothing matched exactly.
const TEXT_SEARCH_SQL = `${PRODUCT_WITH_QTY}
  WHERE p.sku LIKE ? OR p.name_ar LIKE ? OR p.name_en LIKE ?
  ORDER BY p.sku
  LIMIT ${SEARCH_LIMIT}`

export function searchProducts(rawTerm: unknown) {
  const term = String(rawTerm || '').trim()
  if (!term) return []
  const exact = q(EXACT_MATCH_SQL, [term, term, term, term, term])
  if (exact.length) return exact
  const like = `%${term}%`
  return q(TEXT_SEARCH_SQL, [like, like, like])
}

export const EXACT_MATCH_QUERY = EXACT_MATCH_SQL

function hasInvalidCatalogProducts() {
  return !!get(
    `SELECT 1 AS found
     FROM products
     WHERE COALESCE(catalog_version,0)<>2
        OR COALESCE(sku,'')=''
        OR (COALESCE(name_ar,'')='' AND COALESCE(name_en,'')='')
     LIMIT 1`,
  )?.found
}

export function catalogNeedsFullRefresh() {
  return requiresFullCatalogRefresh(
    getMeta('catalog_format_version'),
    hasInvalidCatalogProducts() ? 1 : 0,
  )
}

export function requireFullCatalogRefresh() {
  setMeta('catalog_format_version', '')
  setMeta('sync_cursor', '')
  setMeta('catalog_valid_until', '')
}

export function pendingOutboxCount() {
  return Number(
    get(
      `SELECT COUNT(*) AS count FROM outbox WHERE sync_status IN ('pending','sending')`,
    )?.count || 0,
  )
}
