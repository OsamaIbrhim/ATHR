import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  type MoneyColumnMigrationDb,
  migrateMoneyColumnsToMinorUnits,
} from './money-column-migration'

function createFixtureDatabase() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      cost_price REAL,
      selling_price REAL,
      unit_tax REAL DEFAULT 0,
      cost_price_minor_units INTEGER,
      selling_price_minor_units INTEGER,
      unit_tax_minor_units INTEGER
    );
    CREATE TABLE sales_local (
      sync_id TEXT PRIMARY KEY,
      total REAL,
      total_minor_units INTEGER
    );
    CREATE TABLE sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  return db
}

function wrap(db: Database.Database): MoneyColumnMigrationDb {
  return {
    query: (sql, params = []) => db.prepare(sql).all(...(params as any[])) as any[],
    run: (sql, params = []) => {
      db.prepare(sql).run(...(params as any[]))
    },
    getMeta: (key) =>
      String((db.prepare('SELECT value FROM sync_meta WHERE key=?').get(key) as any)?.value ?? ''),
    setMeta: (key, value) => {
      db.prepare('INSERT OR REPLACE INTO sync_meta (key,value) VALUES (?,?)').run(key, value)
    },
  }
}

describe('POS money-column migration (REAL -> minor-units, non-destructive)', () => {
  it('preserves every existing row and converts REAL amounts to exact minor units', () => {
    const db = createFixtureDatabase()
    db.exec(`
      INSERT INTO products (id, cost_price, selling_price, unit_tax) VALUES
        ('p1', 10.00, 19.99, 0.0),
        ('p2', 5.55, 0.10, 0.14),
        ('p3', 50.00, ${0.1 + 0.2}, 0.14),
        ('p4', 40.00, 100.005, 0.0),
        ('p5', NULL, 30.00, 0);
      INSERT INTO sales_local (sync_id, total) VALUES
        ('s1', 19.99),
        ('s2', ${0.1 + 0.2});
    `)

    const database = wrap(db)
    const report = migrateMoneyColumnsToMinorUnits(database)

    expect(report.alreadyMigrated).toBe(false)
    expect(report.products.rowCount).toBe(5)
    expect(report.salesLocal.rowCount).toBe(2)

    // Original REAL columns are untouched (non-destructive).
    const originalRows = database.query(
      `SELECT id, cost_price, selling_price, unit_tax FROM products ORDER BY id`,
    )
    expect(originalRows).toHaveLength(5)
    expect(originalRows[1]!.selling_price).toBe(0.1)

    const migrated = database.query(
      `SELECT id, cost_price_minor_units, selling_price_minor_units, unit_tax_minor_units
       FROM products ORDER BY id`,
    )
    expect(migrated).toEqual([
      { id: 'p1', cost_price_minor_units: 1000, selling_price_minor_units: 1999, unit_tax_minor_units: 0 },
      { id: 'p2', cost_price_minor_units: 555, selling_price_minor_units: 10, unit_tax_minor_units: 14 },
      { id: 'p3', cost_price_minor_units: 5000, selling_price_minor_units: 30, unit_tax_minor_units: 14 },
      { id: 'p4', cost_price_minor_units: 4000, selling_price_minor_units: 10001, unit_tax_minor_units: 0 },
      { id: 'p5', cost_price_minor_units: null, selling_price_minor_units: 3000, unit_tax_minor_units: 0 },
    ])

    const migratedSales = database.query(
      `SELECT sync_id, total_minor_units FROM sales_local ORDER BY sync_id`,
    )
    expect(migratedSales).toEqual([
      { sync_id: 's1', total_minor_units: 1999 },
      { sync_id: 's2', total_minor_units: 30 },
    ])

    db.close()
  })

  it('is idempotent: running it twice does not double-convert', () => {
    const db = createFixtureDatabase()
    db.exec(`INSERT INTO products (id, cost_price, selling_price, unit_tax) VALUES ('p1', 10.00, 19.99, 0.0);`)
    const database = wrap(db)

    migrateMoneyColumnsToMinorUnits(database)
    const secondRun = migrateMoneyColumnsToMinorUnits(database)

    expect(secondRun.alreadyMigrated).toBe(true)

    const migrated = database.query(
      `SELECT selling_price_minor_units FROM products WHERE id='p1'`,
    )
    expect(migrated[0]!.selling_price_minor_units).toBe(1999)

    db.close()
  })

  it('does not run destructively against a database already migrated', () => {
    const db = createFixtureDatabase()
    db.exec(`INSERT INTO products (id, cost_price, selling_price, unit_tax) VALUES ('p1', 10.00, 19.99, 0.0);`)
    const database = wrap(db)

    migrateMoneyColumnsToMinorUnits(database)
    // Simulate a later app start manually re-deriving a would-be-corrupting value,
    // proving the second run leaves it alone because the marker gates it entirely.
    database.run(`UPDATE products SET selling_price_minor_units=999999 WHERE id='p1'`)
    migrateMoneyColumnsToMinorUnits(database)

    const migrated = database.query(
      `SELECT selling_price_minor_units FROM products WHERE id='p1'`,
    )
    expect(migrated[0]!.selling_price_minor_units).toBe(999999)

    db.close()
  })
})
