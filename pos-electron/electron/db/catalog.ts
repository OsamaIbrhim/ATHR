import { requiresFullCatalogRefresh } from '../catalog-format'
import { CATALOG_PRODUCT_VERSION } from '../catalog-format'
import { get, getMeta, run, setMeta, tx } from './queries'

/** Meta keys that only exist while the catalog is usable / a snapshot is running. */
const CATALOG_STATE_KEYS = [
  'sync_cursor',
  'catalog_format_version',
  'catalog_valid_until',
  'snapshot_after',
  'snapshot_cursor',
] as const

function hasInvalidCatalogProducts() {
  return !!get(
    `SELECT 1 AS found
     FROM products
     WHERE COALESCE(catalog_version,0)<>${CATALOG_PRODUCT_VERSION}
        OR tax_rate IS NULL
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
  tx(() => {
    for (const key of CATALOG_STATE_KEYS) setMeta(key, '')
  })
}

/** Where an interrupted snapshot continues, or null when none is in progress. */
export function snapshotProgress() {
  const cursor = getMeta('snapshot_cursor')
  if (!cursor) return null
  return { after: getMeta('snapshot_after'), cursor }
}

export function pendingOutboxCount() {
  return Number(
    get(
      `SELECT COUNT(*) AS count FROM outbox WHERE sync_status IN ('pending','sending')`,
    )?.count || 0,
  )
}
