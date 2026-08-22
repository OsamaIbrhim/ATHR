'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runPreCheck, runPostCheck } = require('./validate-warehouse-backfill.cjs');

function noopLog() {}

test('runPreCheck reports per-tenant qty_on_hand totals and orphan/ambiguous counts', async () => {
  const runQuery = async (sql) => {
    if (sql.includes('GROUP BY "tenant_id"') && sql.includes('InventoryStock')) {
      return [{ tenant_id: 't1', rows: 3, total_qty_on_hand: 42n }];
    }
    if (sql.includes('count(*)::int AS count') && sql.includes('"Branch" b') && sql.includes('LEFT JOIN "Location"')) {
      return [{ count: 5 }];
    }
    if (sql.includes('HAVING count(w."id") > 1')) return [];
    return [];
  };
  const result = await runPreCheck(runQuery, noopLog);
  assert.equal(result.ok, true);
  assert.equal(result.orphanBranches, 5);
  assert.equal(result.totals[0].total_qty_on_hand, 42n);
  assert.deepEqual(result.ambiguousLocations, []);
});

test('runPostCheck passes when every row resolves 1:1 and no nullness diverges', async () => {
  const runQuery = async (sql) => {
    if (sql.includes('"InventoryStock" WHERE "warehouse_id" IS NULL')) return [{ count: 0 }];
    if (sql.includes('"InventoryMovement" WHERE "warehouse_id" IS NULL')) return [{ count: 0 }];
    if (sql.includes('InventoryCostMovement')) return [{ count: 0 }];
    // totalsByWarehouse aliases the table as `s` (`s."tenant_id"`); check
    // that BEFORE the unaliased totalsByBranch match, since both contain
    // "GROUP BY" and "variant_id".
    if (sql.includes('s."tenant_id"') && sql.includes('GROUP BY s."tenant_id"')) {
      return [{ tenant_id: 't1', variant_id: 'v1', total: 10n }];
    }
    if (sql.includes('GROUP BY "tenant_id", "variant_id"')) {
      return [{ tenant_id: 't1', variant_id: 'v1', total: 10n }];
    }
    if (sql.trim() === 'SELECT count(*)::int AS count FROM "InventoryStock"') {
      return [{ count: 1 }];
    }
    if (sql.includes('count(DISTINCT ("warehouse_id", "variant_id"))')) return [{ count: 1 }];
    return [{ count: 0 }];
  };
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, true);
  assert.equal(result.diverging.length, 0);
});

test('runPostCheck fails loud when InventoryStock has NULL warehouse_id rows', async () => {
  const runQuery = async (sql) => {
    if (sql.includes('"InventoryStock" WHERE "warehouse_id" IS NULL')) return [{ count: 3 }];
    if (sql.includes('"InventoryMovement" WHERE "warehouse_id" IS NULL')) return [{ count: 0 }];
    if (sql.includes('InventoryCostMovement')) return [{ count: 0 }];
    if (sql.includes('GROUP BY "tenant_id", "variant_id"')) return [];
    if (sql.includes('count(DISTINCT ("warehouse_id", "variant_id"))')) return [{ count: 0 }];
    return [{ count: 0 }];
  };
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, false);
  assert.equal(result.stockNullWarehouse, 3);
});

test('runPostCheck fails loud when the backfill fans a row out (row count vs distinct pair mismatch)', async () => {
  const runQuery = async (sql) => {
    if (sql.includes('"InventoryStock" WHERE "warehouse_id" IS NULL')) return [{ count: 0 }];
    if (sql.includes('"InventoryMovement" WHERE "warehouse_id" IS NULL')) return [{ count: 0 }];
    if (sql.includes('InventoryCostMovement')) return [{ count: 0 }];
    if (sql.includes('GROUP BY "tenant_id", "variant_id"')) return [{ tenant_id: 't1', variant_id: 'v1', total: 10n }];
    if (sql === 'SELECT count(*)::int AS count FROM "InventoryStock"') return [{ count: 2 }];
    if (sql.includes('count(DISTINCT ("warehouse_id", "variant_id"))')) return [{ count: 1 }];
    return [{ count: 0 }];
  };
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, false);
  assert.equal(result.stockRowCount, 2);
  assert.equal(result.stockDistinctWarehouseVariant, 1);
});

// The accounting above is worthless if nothing runs it -- same discipline as
// validate-pricing-rule-migration.test.cjs's own CI-wiring pin, for the same
// reason (a migration's own RAISE NOTICE never surfaces in `prisma migrate
// deploy` output).
const workflow = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8').split('\r\n').join('\n');
const migrationGate = workflow.slice(
  workflow.indexOf('\n  migration-gate:'),
  workflow.indexOf('\n  admin:'),
);

// Scoped to the populated-database section specifically: the clean-database
// section (tested separately below) also calls validate-warehouse-backfill
// .cjs, with no `migrate deploy` between its pre/post calls at all (deploy
// already happened in an earlier step there) -- searching the whole
// migration-gate blob would match that occurrence first and defeat these
// ordering assertions.
const populatedSection = migrationGate.slice(
  migrationGate.indexOf('Build a populated database from the release baseline'),
);

test('the migration-gate CI job runs the pre-migration warehouse_id backfill report on the populated database', () => {
  assert.ok(populatedSection.includes('node scripts/validate-warehouse-backfill.cjs\n'));
});

test('the migration-gate CI job runs the post-migration warehouse_id backfill invariant check', () => {
  assert.ok(populatedSection.includes('node scripts/validate-warehouse-backfill.cjs --post-check'));
});

test('the pre-check runs BEFORE the migrations it is accounting for, the post-check after', () => {
  const preCheck = populatedSection.indexOf('node scripts/validate-warehouse-backfill.cjs\n');
  const deploy = populatedSection.indexOf('npx prisma migrate deploy', preCheck);
  const postCheck = populatedSection.indexOf('node scripts/validate-warehouse-backfill.cjs --post-check');
  assert.ok(preCheck > -1 && deploy > preCheck && postCheck > deploy);
});

test('the migration-gate CI job seeds a warehouse-less branch into the populated database before upgrading it', () => {
  const seedStep = populatedSection.indexOf('node scripts/ci-seed-warehouse-less-branch.cjs\n');
  const preCheck = populatedSection.indexOf('node scripts/validate-warehouse-backfill.cjs\n');
  assert.ok(seedStep > -1 && preCheck > seedStep);
});

test('the migration-gate CI job proves sync against the upgraded populated database, not only the empty clean one', () => {
  const cleanCheck = migrationGate.indexOf('Verify sync snapshot behaviour at catalog volume');
  const upgradeCheck = migrationGate.indexOf(
    'node scripts/verify-sync-snapshot-behaviour.cjs',
    migrationGate.indexOf('athr_migrations_upgrade'),
  );
  assert.ok(cleanCheck > -1 && upgradeCheck > -1 && upgradeCheck > cleanCheck);
});

test('the migration-gate CI job also runs the warehouse_id backfill accounting on the clean database', () => {
  const cleanSection = migrationGate.slice(0, migrationGate.indexOf('Build a populated database from the release baseline'));
  assert.ok(cleanSection.includes('node scripts/validate-warehouse-backfill.cjs'));
  assert.ok(cleanSection.includes('node scripts/validate-warehouse-backfill.cjs --post-check'));
});
