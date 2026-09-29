/**
 * Migration v4: the generic catalog (W2a). `products` is a cache of the server
 * catalog, so it is rebuilt (SQLite cannot drop the indexed barcode columns);
 * the barcodes move to their own table and `stock.qty` becomes a decimal.
 * Never touches `outbox`, `sales_local` or `held_sales`.
 */

/** The columns the rebuilt `products` copies over unchanged. */
const KEPT_PRODUCT_COLUMNS = `id, sku, name_en, name_ar, cost_price, selling_price, unit_tax, catalog_version,
  cost_price_minor_units, selling_price_minor_units, unit_tax_minor_units`

// A size/color pair becomes the display label until the next snapshot brings the real one.
const LEGACY_LABEL = `NULLIF(TRIM(
  COALESCE(size,'') ||
  CASE WHEN COALESCE(size,'')<>'' AND COALESCE(color,'')<>'' THEN ' · ' ELSE '' END ||
  COALESCE(color,'')
), '')`

export const V4_SCHEMA = `
  CREATE TABLE barcodes (
    code TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL,
    pack_qty REAL NOT NULL,
    kind TEXT NOT NULL
  );
  CREATE INDEX barcodes_variant_idx ON barcodes (variant_id);

  -- Keep old tills scannable until the snapshot brings the real barcodes.
  INSERT OR IGNORE INTO barcodes (code, variant_id, pack_qty, kind)
    SELECT barcode_ean13, id, 1, 'standard' FROM products WHERE COALESCE(barcode_ean13,'')<>'';
  INSERT OR IGNORE INTO barcodes (code, variant_id, pack_qty, kind)
    SELECT barcode_internal, id, 1, 'standard' FROM products WHERE COALESCE(barcode_internal,'')<>'';

  DROP INDEX IF EXISTS products_barcode_ean13_idx;
  DROP INDEX IF EXISTS products_barcode_internal_idx;
  DROP INDEX IF EXISTS products_sku_idx;
  CREATE TABLE products_v4 (
    id TEXT PRIMARY KEY,
    sku TEXT,
    name_en TEXT,
    name_ar TEXT,
    label TEXT,
    attributes TEXT,
    uom_code TEXT,
    uom_name_ar TEXT,
    uom_precision INTEGER NOT NULL DEFAULT 0,
    cost_price REAL,
    selling_price REAL,
    unit_tax REAL DEFAULT 0,
    catalog_version INTEGER NOT NULL DEFAULT 2,
    cost_price_minor_units INTEGER,
    selling_price_minor_units INTEGER,
    unit_tax_minor_units INTEGER DEFAULT 0
  );
  INSERT INTO products_v4 (${KEPT_PRODUCT_COLUMNS}, label)
    SELECT ${KEPT_PRODUCT_COLUMNS}, ${LEGACY_LABEL} FROM products;
  DROP TABLE products;
  ALTER TABLE products_v4 RENAME TO products;
  CREATE INDEX products_sku_idx ON products (sku);

  CREATE TABLE stock_v4 (
    variant_id TEXT PRIMARY KEY,
    qty REAL NOT NULL DEFAULT 0
  );
  INSERT INTO stock_v4 (variant_id, qty) SELECT variant_id, COALESCE(qty, 0) FROM stock;
  DROP TABLE stock;
  ALTER TABLE stock_v4 RENAME TO stock;

  -- Old rows fail the v3 catalog check, so the next sync is a full snapshot.
  DELETE FROM sync_meta WHERE key IN
    ('sync_cursor', 'catalog_format_version', 'catalog_valid_until', 'snapshot_after', 'snapshot_cursor');
`
