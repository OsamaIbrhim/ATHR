import { decimalToMinorUnits } from './money-codec'

/**
 * Minimal SQL surface this migration needs, so it can run against both the
 * real sql.js database (via thin wrappers around `q`/`run`/`getMeta`/
 * `setMeta` in main.ts) and an in-memory fixture database in tests.
 */
export interface MoneyColumnMigrationDb {
  query(sql: string, params?: unknown[]): Array<Record<string, unknown>>
  run(sql: string, params?: unknown[]): void
  getMeta(key: string): string
  setMeta(key: string, value: string): void
}

export interface MoneyColumnChecksum {
  readonly rowCount: number
  readonly sumBeforeDecimal: number
  readonly sumAfterDecimal: number
}

export interface MoneyColumnMigrationReport {
  readonly alreadyMigrated: boolean
  readonly products: MoneyColumnChecksum
  readonly salesLocal: MoneyColumnChecksum
}

const MIGRATION_MARKER_KEY = 'money_minor_units_migration_version'
const MIGRATION_MARKER_VERSION = '1'

function realColumnToMinorUnitsOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  // `String(numeric)` (the shortest round-trip decimal) is used deliberately
  // instead of `numeric.toFixed(2)`: toFixed rounds using the raw IEEE-754
  // binary value, which for inputs like 100.005 (whose nearest double is
  // actually ~100.00499999999999901) silently rounds the wrong way before
  // decimalToMinorUnits ever sees it. The shortest round-trip string
  // preserves the digits as originally written, letting Money's exact
  // decimal parser make the correct HALF_UP rounding call instead.
  return decimalToMinorUnits(String(numeric))
}

/**
 * Forward-only, non-destructive backfill of the `products`
 * (cost_price/selling_price/unit_tax) and `sales_local` (total) REAL
 * columns into their `*_minor_units` INTEGER counterparts. The REAL
 * columns are never modified or dropped by this migration — only the new
 * columns are populated — so every pre-existing local row is preserved
 * exactly as-is (WP-001's non-destructive local-data migration pattern).
 *
 * Idempotent: gated by a `sync_meta` marker (the same key/value mechanism
 * already used for `catalog_format_version`/`sync_cursor`), so re-running
 * this after it has already completed is a no-op.
 */
export function migrateMoneyColumnsToMinorUnits(
  database: MoneyColumnMigrationDb,
): MoneyColumnMigrationReport {
  if (database.getMeta(MIGRATION_MARKER_KEY) === MIGRATION_MARKER_VERSION) {
    return {
      alreadyMigrated: true,
      products: { rowCount: 0, sumBeforeDecimal: 0, sumAfterDecimal: 0 },
      salesLocal: { rowCount: 0, sumBeforeDecimal: 0, sumAfterDecimal: 0 },
    }
  }

  const products = database.query(
    `SELECT id, cost_price, selling_price, unit_tax FROM products
     WHERE cost_price_minor_units IS NULL
        OR selling_price_minor_units IS NULL
        OR unit_tax_minor_units IS NULL`,
  )

  let productsSumBefore = 0
  let productsSumAfter = 0
  for (const row of products) {
    const costMinorUnits = realColumnToMinorUnitsOrNull(row.cost_price)
    const sellingMinorUnits = realColumnToMinorUnitsOrNull(row.selling_price)
    const taxMinorUnits = realColumnToMinorUnitsOrNull(row.unit_tax)

    productsSumBefore +=
      Number(row.cost_price || 0) + Number(row.selling_price || 0) + Number(row.unit_tax || 0)
    productsSumAfter +=
      (costMinorUnits ?? 0) / 100 + (sellingMinorUnits ?? 0) / 100 + (taxMinorUnits ?? 0) / 100

    database.run(
      `UPDATE products
       SET cost_price_minor_units=?, selling_price_minor_units=?, unit_tax_minor_units=?
       WHERE id=?`,
      [costMinorUnits, sellingMinorUnits, taxMinorUnits, row.id],
    )
  }

  const sales = database.query(
    `SELECT sync_id, total FROM sales_local WHERE total_minor_units IS NULL`,
  )

  let salesSumBefore = 0
  let salesSumAfter = 0
  for (const row of sales) {
    const totalMinorUnits = realColumnToMinorUnitsOrNull(row.total)
    salesSumBefore += Number(row.total || 0)
    salesSumAfter += (totalMinorUnits ?? 0) / 100

    database.run(`UPDATE sales_local SET total_minor_units=? WHERE sync_id=?`, [
      totalMinorUnits,
      row.sync_id,
    ])
  }

  database.setMeta(MIGRATION_MARKER_KEY, MIGRATION_MARKER_VERSION)

  return {
    alreadyMigrated: false,
    products: {
      rowCount: products.length,
      sumBeforeDecimal: productsSumBefore,
      sumAfterDecimal: productsSumAfter,
    },
    salesLocal: {
      rowCount: sales.length,
      sumBeforeDecimal: salesSumBefore,
      sumAfterDecimal: salesSumAfter,
    },
  }
}
