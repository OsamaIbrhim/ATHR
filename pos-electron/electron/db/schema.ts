import { CATALOG_PRODUCT_VERSION } from '../catalog-format'

/**
 * The local schema, version 1: the first release's database. Money is stored
 * only as integer minor units (piastres); decimals exist at the IPC boundary.
 *
 * `products`, `barcodes`, `stock` and `sellers` are a cache of the server
 * catalog, rebuilt by a snapshot; `outbox`, `sales_local` and `held_sales`
 * hold till-only data that a later migration must never lose.
 */
export const SCHEMA_V1 = `
  CREATE TABLE products (
    id TEXT PRIMARY KEY,
    sku TEXT,
    name_en TEXT,
    name_ar TEXT,
    label TEXT,
    attributes TEXT,
    uom_code TEXT,
    uom_name_ar TEXT,
    uom_precision INTEGER NOT NULL DEFAULT 0,
    selling_price_minor_units INTEGER NOT NULL DEFAULT 0,
    unit_tax_minor_units INTEGER NOT NULL DEFAULT 0,
    catalog_version INTEGER NOT NULL DEFAULT ${CATALOG_PRODUCT_VERSION}
  );
  CREATE INDEX products_sku_idx ON products (sku);

  CREATE TABLE barcodes (
    code TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL,
    pack_qty REAL NOT NULL,
    kind TEXT NOT NULL
  );
  CREATE INDEX barcodes_variant_idx ON barcodes (variant_id);

  CREATE TABLE stock (
    variant_id TEXT PRIMARY KEY,
    qty REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE sellers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE outbox (
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
  CREATE INDEX outbox_status_created_idx ON outbox (sync_status, created_at);

  CREATE TABLE sales_local (
    sync_id TEXT PRIMARY KEY,
    invoice_number TEXT,
    total_minor_units INTEGER,
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
    void_reason TEXT
  );
  CREATE INDEX sales_local_occurred_idx ON sales_local (COALESCE(occurred_at, created_at) DESC);

  CREATE TABLE held_sales (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL,
    cashier_id TEXT NOT NULL,
    shift_id TEXT NOT NULL,
    customer_json TEXT,
    items_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX held_sales_scope_created_idx
    ON held_sales (branch_id, cashier_id, shift_id, created_at DESC);

  CREATE TABLE sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`
