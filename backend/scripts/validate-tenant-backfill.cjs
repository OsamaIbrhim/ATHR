#!/usr/bin/env node
// WP-005 Phase B, MT-MIG-004 ambiguous-row validator.
//
// Pre-migration (default): for every tenant-owned table that resolves its
// tenant via a Branch/Location ownership chain, confirms every non-null
// chain column actually resolves to a Location row. Any row whose chain
// column is set but does not resolve is a HARD STOP (ambiguous/orphaned) —
// this script exits non-zero and prints the exact offending row IDs, never a
// bare count, and never assigns a default silently (BR-TERR-100, MT-MIG-004).
// Rows with no chain at all (nullable chain column is NULL, or the table has
// no chain column) are explicitly reported as "unconditional assignment to
// the Initial ATHR Demo Tenant" candidates — not silently passed over.
//
// Post-migration (--post-check): confirms zero rows remain with tenant_id
// IS NULL across every tenant-owned table.

const INITIAL_TENANT_NAME = 'Initial ATHR Demo Tenant';

// branch-chain tables: tenant resolved via (possibly nullable) branch_id/
// from_branch_id -> Location.id (Location.id === legacy Branch.id).
const BRANCH_CHAIN_TABLES = [
  { table: 'Branch', column: 'id', nullable: false },
  { table: 'InventoryStock', column: 'branch_id', nullable: false },
  { table: 'InventoryMovement', column: 'branch_id', nullable: false },
  { table: 'InventoryCostMovement', column: 'branch_id', nullable: true },
  { table: 'SalesInvoice', column: 'branch_id', nullable: false },
  { table: 'PosTerminal', column: 'branch_id', nullable: false },
  { table: 'PosTerminalEnrollment', column: 'branch_id', nullable: false },
  { table: 'SyncChange', column: 'branch_id', nullable: true },
  { table: 'Return', column: 'branch_id', nullable: false },
  { table: 'PurchaseInvoice', column: 'branch_id', nullable: false },
  { table: 'SupplierReturn', column: 'branch_id', nullable: false },
  { table: 'Transfer', column: 'from_branch_id', nullable: false },
  { table: 'OfferSuggestion', column: 'branch_id', nullable: false },
  { table: 'Shift', column: 'branch_id', nullable: false },
];

// parent-chain tables: tenant resolved via a FK to an already tenant-scoped
// parent row (checked post-migration only — the parent's own tenant_id must
// be non-null by that point).
const PARENT_CHAIN_TABLES = [
  { table: 'SalesInvoiceItem', column: 'sales_invoice_id', parent: 'SalesInvoice' },
  { table: 'ReturnItem', column: 'return_id', parent: 'Return' },
  { table: 'PurchaseInvoiceItem', column: 'purchase_invoice_id', parent: 'PurchaseInvoice' },
  { table: 'SupplierReturnItem', column: 'supplier_return_id', parent: 'SupplierReturn' },
  { table: 'TransferItem', column: 'transfer_id', parent: 'Transfer' },
  { table: 'TransferCommand', column: 'transfer_id', parent: 'Transfer' },
  { table: 'TransferTransitMovement', column: 'transfer_id', parent: 'Transfer' },
  { table: 'ProductVariant', column: 'product_id', parent: 'Product' },
  { table: 'SellerCommissionPeriodRow', column: 'period_id', parent: 'SellerCommissionPeriod' },
];

// unconditional tables: no ownership chain in the current schema at all;
// every row is explicitly assigned to the Initial ATHR Demo Tenant because
// it is the only Tenant that exists.
const UNCONDITIONAL_TABLES = [
  'SellerCommissionSettings',
  'SellerCommissionOverride',
  'SellerCommissionPeriod',
  'Supplier',
  'Category',
  'Product',
  'Customer',
  'PricingRule',
  'AuditLog',
];

const ALL_TABLES = [
  ...BRANCH_CHAIN_TABLES.map((t) => t.table),
  ...PARENT_CHAIN_TABLES.map((t) => t.table),
  ...UNCONDITIONAL_TABLES,
];

// Tables whose primary key is not a single "id" column — either composite
// (report the concatenated key columns) or a differently-named single column
// (SyncChange.sequence).
const NON_STANDARD_KEY_TABLES = {
  InventoryStock: ['branch_id', 'variant_id'],
  SellerCommissionPeriodRow: ['period_id', 'seller_id'],
  SellerCommissionOverride: ['seller_id'],
  SyncChange: ['sequence'],
};

function idExpression(table, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const keys = NON_STANDARD_KEY_TABLES[table];
  if (!keys) return `${prefix}"id"::text`;
  return keys.map((k) => `${prefix}"${k}"::text`).join(` || ':' || `);
}

// runQuery(sql) => Promise<Array<object>>. Injectable so this logic is
// testable without a real database (see validate-tenant-backfill.test.cjs).
async function runPreCheck(runQuery, log = console.log, logError = console.error) {
  log(`Pre-migration ambiguous-row check (${ALL_TABLES.length} tenant-owned tables)`);
  const failures = [];

  for (const { table, column, nullable } of BRANCH_CHAIN_TABLES) {
    if (table === 'Branch') continue; // Branch resolves via its own id, always unambiguous.

    const orphans = await runQuery(
      `SELECT ${idExpression(table, 'x')} AS id FROM "${table}" x
       WHERE x."${column}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "Location" l WHERE l."id" = x."${column}")`,
    );
    if (orphans.length > 0) {
      failures.push({ table, column, ids: orphans.map((r) => r.id) });
      logError(
        `HARD STOP: ${table}.${column} has ${orphans.length} row(s) pointing at a branch/location that does not exist: ${orphans
          .map((r) => r.id)
          .join(', ')}`,
      );
    }

    if (nullable) {
      const [{ count }] = await runQuery(`SELECT count(*)::int AS count FROM "${table}" WHERE "${column}" IS NULL`);
      if (count > 0) {
        log(`INFO: ${table} has ${count} row(s) with no ${column} — will be unconditionally assigned to "${INITIAL_TENANT_NAME}".`);
      }
    }
  }

  for (const table of UNCONDITIONAL_TABLES) {
    const [{ count }] = await runQuery(`SELECT count(*)::int AS count FROM "${table}"`);
    if (count > 0) {
      log(`INFO: ${table} has no ownership chain — all ${count} row(s) will be unconditionally assigned to "${INITIAL_TENANT_NAME}".`);
    }
  }

  if (failures.length > 0) {
    const totalRows = failures.reduce((sum, f) => sum + f.ids.length, 0);
    logError(`\nFAILED: ${totalRows} ambiguous/orphaned row(s) found. Migration must not proceed.`);
    return { ok: false, failures };
  }

  log('\nPASSED: no ambiguous/orphaned rows found. Safe to apply MT-MIG-004.');
  return { ok: true, failures: [] };
}

async function runPostCheck(runQuery, log = console.log, logError = console.error) {
  log(`Post-migration null-tenant_id check (${ALL_TABLES.length} tenant-owned tables)`);
  const failures = [];

  for (const table of ALL_TABLES) {
    const rows = await runQuery(`SELECT ${idExpression(table)} AS id FROM "${table}" WHERE "tenant_id" IS NULL LIMIT 20`);
    if (rows.length > 0) {
      failures.push({ table, ids: rows.map((r) => r.id) });
      logError(`FAILED: ${table} has row(s) with tenant_id IS NULL: ${rows.map((r) => r.id).join(', ')}`);
    }
  }

  if (failures.length > 0) {
    const totalRows = failures.reduce((sum, f) => sum + f.ids.length, 0);
    logError(`\nFAILED: ${totalRows}+ row(s) with tenant_id IS NULL remain.`);
    return { ok: false, failures };
  }

  log('\nPASSED: zero rows with tenant_id IS NULL across all tenant-owned tables.');
  return { ok: true, failures: [] };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const runQuery = (sql) => prisma.$queryRawUnsafe(sql);
  try {
    const result = process.argv.includes('--post-check')
      ? await runPostCheck(runQuery)
      : await runPreCheck(runQuery);
    if (!result.ok) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  BRANCH_CHAIN_TABLES,
  PARENT_CHAIN_TABLES,
  UNCONDITIONAL_TABLES,
  ALL_TABLES,
  runPreCheck,
  runPostCheck,
};
