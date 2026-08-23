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
// by accident CLAUDE.md warns against (this was flagged in PR review: a
// prior version of this file's row-level check made the same mistake it
// was arguing against -- see below). Pre-check still reports the raw totals
// per tenant, for the log record the standing rule asks for.
//
// The real invariant worth proving is ROW-LEVEL, and it has to be a GENUINE
// cross-check, not two queries that happen to read the same way: does every
// InventoryStock row's warehouse_id actually resolve, via
// Warehouse.location_id, back to THAT ROW'S OWN branch_id? `totalsByBranch`
// sums qty_on_hand grouped straight off the row's own (always-populated,
// untouched-by-this-PR) branch_id -- the ground truth. `totalsByWarehouse`
// re-derives the same per-(tenant, variant) totals via the OTHER path: an
// INNER JOIN from warehouse_id to Warehouse, requiring
// `w."location_id" = s."branch_id"`. That join condition is the actual
// assertion -- a row whose warehouse_id was backfilled to the WRONG
// warehouse (misattribution, a stale match, a cross-branch collision) fails
// the join and silently drops out of totalsByWarehouse, which is exactly
// what makes the two totals diverge. A prior version of this file grouped
// both sides by `(tenant_id, variant_id)` directly off the same table with
// no reference to branch_id or warehouse_id in either query -- the two
// queries were textually identical, so the comparison could never be
// non-empty. Caught in PR review; drilled below (see the PR description)
// by actually pointing one row's warehouse_id at a different branch's
// warehouse and watching this check fail, naming the row.

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
  // The INNER JOIN's third condition (w."location_id" = s."branch_id") is
  // the actual test: a row only contributes to this total if its backfilled
  // warehouse_id resolves back to ITS OWN branch. See the header comment.
  const totalsByWarehouse = await runQuery(
    `SELECT s."tenant_id", s."variant_id", COALESCE(SUM(s."qty_on_hand"), 0)::bigint AS total
     FROM "InventoryStock" s
     JOIN "Warehouse" w
       ON w."tenant_id" = s."tenant_id"
      AND w."id" = s."warehouse_id"
      AND w."location_id" = s."branch_id"
     GROUP BY s."tenant_id", s."variant_id"`,
  );
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
    problems.push(
      `${diverging.length} (tenant, variant) total(s) diverge between branch_id-grouping and the warehouse_id -> Warehouse.location_id -> branch_id round-trip -- at least one row's warehouse_id does not resolve back to its own branch: ${diverging.join(', ')}`,
    );
  }

  if (problems.length > 0) {
    logError(`FAILED: ${problems.join('; ')}.`);
    return { ok: false, stockNullWarehouse, movementNullWarehouse, costMismatch, stockRowCount, stockDistinctWarehouseVariant, diverging };
  }

  log(`PASSED: 0 NULL warehouse_id on InventoryStock/InventoryMovement, InventoryCostMovement nullness mirrors branch_id, all ${stockRowCount} InventoryStock row(s) map 1:1 onto (warehouse_id, variant_id), and every row's warehouse_id round-trips back to its own branch_id via Warehouse.location_id with identical per-(tenant, variant) qty_on_hand totals under both groupings.`);
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
