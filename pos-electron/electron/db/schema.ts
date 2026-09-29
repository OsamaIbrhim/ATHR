/**
 * Final ("current") local schema, plus the columns that older releases added
 * after a table was first created. A fresh database is built from
 * `CREATE_TABLES`; a legacy database (created by any earlier sql.js release)
 * already has the tables and only needs the columns from `ADDED_COLUMNS` that
 * it is missing. Both paths end in the same schema.
 */

export const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT,
    name_en TEXT,
    name_ar TEXT,
    barcode_ean13 TEXT,
    barcode_internal TEXT,
    size TEXT,
    color TEXT,
    cost_price REAL,
    selling_price REAL,
    unit_tax REAL DEFAULT 0,
    catalog_version INTEGER NOT NULL DEFAULT 2,
    cost_price_minor_units INTEGER,
    selling_price_minor_units INTEGER,
    unit_tax_minor_units INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS stock (
    variant_id TEXT PRIMARY KEY,
    qty INTEGER
  );
  CREATE TABLE IF NOT EXISTS sellers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    type TEXT,
    payload TEXT,
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT,
    attempt_count INTEGER DEFAULT 0,
    last_attempt_at TEXT,
    last_error TEXT,
    server_document_id TEXT,
    server_document_number TEXT,
    terminal_sequence TEXT,
    warning_codes TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sales_local (
    sync_id TEXT PRIMARY KEY,
    invoice_number TEXT,
    total REAL,
    created_at TEXT,
    occurred_at TEXT,
    payment_method TEXT,
    customer_phone TEXT,
    cashier_id TEXT,
    seller_id TEXT,
    shift_id TEXT,
    offline_session_id TEXT,
    terminal_sequence TEXT,
    server_invoice_id TEXT,
    server_invoice_number TEXT,
    synced_at TEXT,
    sync_result TEXT,
    warning_codes TEXT,
    voided_at TEXT,
    void_reason TEXT,
    total_minor_units INTEGER
  );
  CREATE TABLE IF NOT EXISTS held_sales (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    customer_json TEXT,
    items_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

/** Every column an older release added with ALTER TABLE, in the original order. */
export const ADDED_COLUMNS: ReadonlyArray<readonly [table: string, column: string, definition: string]> = [
  ['products', 'unit_tax', 'REAL DEFAULT 0'],
  ['products', 'name_ar', 'TEXT'],
  ['products', 'catalog_version', 'INTEGER NOT NULL DEFAULT 2'],
  ['sales_local', 'payment_method', 'TEXT'],
  ['sales_local', 'customer_phone', 'TEXT'],
  ['sales_local', 'server_invoice_id', 'TEXT'],
  ['sales_local', 'server_invoice_number', 'TEXT'],
  ['sales_local', 'synced_at', 'TEXT'],
  ['sales_local', 'occurred_at', 'TEXT'],
  ['sales_local', 'cashier_id', 'TEXT'],
  ['sales_local', 'seller_id', 'TEXT'],
  ['sales_local', 'shift_id', 'TEXT'],
  ['sales_local', 'offline_session_id', 'TEXT'],
  ['sales_local', 'terminal_sequence', 'TEXT'],
  ['sales_local', 'sync_result', 'TEXT'],
  ['sales_local', 'warning_codes', 'TEXT'],
  ['outbox', 'attempt_count', 'INTEGER DEFAULT 0'],
  ['outbox', 'last_attempt_at', 'TEXT'],
  ['outbox', 'last_error', 'TEXT'],
  ['outbox', 'server_document_id', 'TEXT'],
  ['outbox', 'server_document_number', 'TEXT'],
  ['outbox', 'terminal_sequence', 'TEXT'],
  ['outbox', 'warning_codes', 'TEXT'],
  ['outbox', 'updated_at', 'TEXT'],
  ['sales_local', 'voided_at', 'TEXT'],
  ['sales_local', 'void_reason', 'TEXT'],
  ['products', 'cost_price_minor_units', 'INTEGER'],
  ['products', 'selling_price_minor_units', 'INTEGER'],
  ['products', 'unit_tax_minor_units', 'INTEGER DEFAULT 0'],
  ['sales_local', 'total_minor_units', 'INTEGER'],
]

/**
 * Indexes for the hot paths. `stock.variant_id` is already the primary key, so
 * stock-by-variant lookups are indexed without an extra one.
 */
export const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS held_sales_scope_created_idx
    ON held_sales (branch_id, cashier_id, shift_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS products_barcode_ean13_idx ON products (barcode_ean13);
  CREATE INDEX IF NOT EXISTS products_barcode_internal_idx ON products (barcode_internal);
  CREATE INDEX IF NOT EXISTS products_sku_idx ON products (sku);
  CREATE INDEX IF NOT EXISTS outbox_status_created_idx ON outbox (sync_status, created_at);
  CREATE INDEX IF NOT EXISTS sales_local_occurred_idx
    ON sales_local (COALESCE(occurred_at, created_at) DESC);
`
