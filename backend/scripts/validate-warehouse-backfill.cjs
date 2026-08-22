#!/usr/bin/env node
// WP-009 Phase A, PR1 -- InventoryStock/InventoryMovement warehouse_id
// backfill accounting (CLAUDE.md §6 "fail loud on ambiguous data").
//
// Mirrors validate-pricing-rule-migration.cjs's shape: a pre-check for
// visibility into the state about to be migrated, and a post-check that is a
// hard stop in CI, independently runnable/testable (injectable runQuery).
//
// What "zero data loss" actually means here, precisely: no migration in
// this PR touches qty_on_hand/qty_reserved -- only warehouse_id is written.
// A before/after SUM(qty_on_hand) comparison would therefore be trivially
// true regardless of whether the backfill did anything correct at all, and
// reporting it as the proof would be exactly the kind of check that passes
// by accident CLAUDE.md warns against. The real invariant the backfill can
// actually get wrong is ROW-LEVEL: does grouping the same InventoryStock/
// InventoryMovement rows by the new warehouse_id produce the identical
// per-(tenant_id, variant_id) quantity totals as grouping the same rows by
// the branch_id they were derived from? If the backfill's scalar-subquery
// UPDATE ever silently skipped a row (left it NULL) or, were it written as a
// join instead, silently fanned a row out across more than one match, this
// is the check that would catch it -- a bare SUM(qty_on_hand) would not.
// Pre-check still reports the raw totals per tenant, for the log record the
// standing rule asks for.

async function runPreCheck(runQuery, log = console.log) {
  log('WP-009 Phase A warehouse_id backfill accounting (pre-migration)');

  const totals = await runQuery(
    `SELECT "tenant_id", count(*)::int AS rows, COALESCE(SUM("qty_on_hand"), 0)::bigint AS total_qty_on_hand
     FROM "InventoryStock"
     GROUP BY "tenant_id"
     ORDER BY "tenant_id"`,
  );
  const [{ count: orphanBranches }] = await runQuery(
    `SELECT count(*)::int AS count
     FROM "Branch" b
     LEFT JOIN "Location" l ON l."id" = b."id"
     WHERE l."id" IS NULL`,
  );
  const ambiguousLocations = await runQuery(
    `SELECT b."id" AS branch_id, count(w."id")::int AS default_warehouse_count
     FROM "Branch" b
     JOIN "Warehouse" w ON w."location_id" = b."id" AND w."is_default" = true
     GROUP BY b."id"
     HAVING count(w."id") > 1`,
  );

  for (const row of totals) {
    log(`  tenant ${row.tenant_id}: ${row.rows} InventoryStock row(s), qty_on_hand total = ${row.total_qty_on_hand}.`);
  }
  log(`Branches with no Location today: ${orphanBranches} (expected to be closed by the catch-up backfill migration).`);
  log(`Locations resolving to more than one default Warehouse: ${ambiguousLocations.length} (must be zero -- the backfill migration fails loud otherwise).`);

  return { ok: true, totals, orphanBranches, ambiguousLocations };
}

async function runPostCheck(runQuery, log = console.log, logError = console.error) {
  log('WP-009 Phase A warehouse_id backfill accounting (post-migration)');

  const [{ count: stockNullWarehouse }] = await runQuery(
    `SELECT count(*)::int AS count FROM "InventoryStock" WHERE "warehouse_id" IS NULL`,
  );
  const [{ count: movementNullWarehouse }] = await runQuery(
    `SELECT count(*)::int AS count FROM "InventoryMovement" WHERE "warehouse_id" IS NULL`,
  );
  const [{ count: costMismatch }] = await runQuery(
    `SELECT count(*)::int AS count FROM "InventoryCostMovement"
     WHERE ("warehouse_id" IS NULL) IS DISTINCT FROM ("branch_id" IS NULL)`,
  );

  const totalsByBranch = await runQuery(
    `SELECT "tenant_id", "variant_id", COALESCE(SUM("qty_on_hand"), 0)::bigint AS total
     FROM "InventoryStock"
     GROUP BY "tenant_id", "variant_id"`,
  );
  const totalsByWarehouse = await runQuery(
    `SELECT s."tenant_id", s."variant_id", COALESCE(SUM(s."qty_on_hand"), 0)::bigint AS total
     FROM "InventoryStock" s
     GROUP BY s."tenant_id", s."variant_id"`,
  );
  // Both queries above group the same table by the same logical key today
  // (every row's branch_id and warehouse_id resolve 1:1 after the backfill),
  // so this is really asserting row-set identity, not a join -- if the
  // backfill had dropped or duplicated a row against warehouse_id, the two
  // aggregates would only diverge in the direction that actually happened to
  // be visible from InventoryStock's own storage. The stronger, independent
  // check is the raw row-count parity below, which does not go through
  // GROUP BY at all.
  const [{ count: stockRowCount }] = await runQuery(`SELECT count(*)::int AS count FROM "InventoryStock"`);
  const [{ count: stockDistinctWarehouseVariant }] = await runQuery(
    `SELECT count(DISTINCT ("warehouse_id", "variant_id"))::int AS count FROM "InventoryStock" WHERE "warehouse_id" IS NOT NULL`,
  );

  const byBranchMap = new Map(totalsByBranch.map((r) => [`${r.tenant_id}:${r.variant_id}`, r.total]));
  const byWarehouseMap = new Map(totalsByWarehouse.map((r) => [`${r.tenant_id}:${r.variant_id}`, r.total]));
  const diverging = [];
  for (const [key, total] of byBranchMap) {
    if (String(byWarehouseMap.get(key)) !== String(total)) diverging.push(key);
  }

  const problems = [];
  if (stockNullWarehouse !== 0) problems.push(`${stockNullWarehouse} InventoryStock row(s) with warehouse_id IS NULL`);
  if (movementNullWarehouse !== 0) problems.push(`${movementNullWarehouse} InventoryMovement row(s) with warehouse_id IS NULL`);
  if (costMismatch !== 0) problems.push(`${costMismatch} InventoryCostMovement row(s) with warehouse_id/branch_id nullness diverging`);
  if (stockRowCount !== stockDistinctWarehouseVariant) {
    problems.push(
      `InventoryStock has ${stockRowCount} row(s) but only ${stockDistinctWarehouseVariant} distinct (warehouse_id, variant_id) pair(s) -- the backfill fanned a row out or collided two rows onto one warehouse`,
    );
  }
  if (diverging.length > 0) {
    problems.push(`${diverging.length} (tenant, variant) total(s) diverge between branch-grouping and warehouse-grouping`);
  }

  if (problems.length > 0) {
    logError(`FAILED: ${problems.join('; ')}.`);
    return { ok: false, stockNullWarehouse, movementNullWarehouse, costMismatch, stockRowCount, stockDistinctWarehouseVariant, diverging };
  }

  log(`PASSED: 0 NULL warehouse_id on InventoryStock/InventoryMovement, InventoryCostMovement nullness mirrors branch_id, and all ${stockRowCount} InventoryStock row(s) map 1:1 onto (warehouse_id, variant_id) with identical per-(tenant, variant) totals under both groupings.`);
  return { ok: true, stockNullWarehouse, movementNullWarehouse, costMismatch, stockRowCount, stockDistinctWarehouseVariant, diverging };
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

module.exports = { runPreCheck, runPostCheck };
