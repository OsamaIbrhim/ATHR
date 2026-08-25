'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countMigrationFolders,
  inspectMigrationUrl,
  isAdvisoryLockTimeout,
  listMigrationFolders,
} = require('./prisma-migrate-deploy.cjs');

test('reports the repository migration history used by deployment', () => {
  // Master corrected WP-008 Phase A's stale count to 153 (PR #67, 628defa).
  // Phase B adds 7 more folders (202608070001-0007), so 153 -> 160.
  // Phase C adds 8 (202608130001-0008), so 160 -> 168, and the 202608130xxx
  // tax folders now sort last.
  // Phase D adds 2 (202608160001_add_promotion_coupon_bundle_tables,
  // 202608160002_add_promotion_coupon_uniqueness_constraints -- split in two
  // deliberately, see that second migration's own header comment and the
  // Phase D PR description), so 168 -> 170.
  // WP-009 Phase A PR1 adds 3 (202608220001 expand, 202608220002 catch-up
  // Location/Warehouse backfill, 202608220003 InventoryStock/Movement/
  // CostMovement warehouse_id backfill -- deliberately three separate
  // migrations, see the PR description for why each is its own step), so
  // 170 -> 173. WP-009 Phase A PR2 adds 1 more (202608250001 constrain +
  // key swap, atomic with the application-code cutover -- see that PR's
  // description for why it cannot be split further), so 173 -> 174.
  assert.equal(countMigrationFolders(), 174);
  assert.deepEqual(listMigrationFolders().slice(-4), [
    '202608220001_wp009_phasea_expand_warehouse_dimension',
    '202608220002_wp009_phasea_backfill_location_warehouse_for_orphan_branches',
    '202608220003_wp009_phasea_backfill_inventory_warehouse_id',
    '202608250001_wp009_phasea_constrain_and_cutover',
  ]);
});

test('accepts direct and session-pooler migration connections', () => {
  assert.deepEqual(
    inspectMigrationUrl(
      'postgresql://postgres:secret@db.project.supabase.co:5432/postgres?sslmode=require',
    ),
    { connectionKind: 'supabase-direct', port: 5432 },
  );
  assert.deepEqual(
    inspectMigrationUrl(
      'postgresql://postgres.project:secret@region.pooler.supabase.com:5432/postgres?sslmode=require',
    ),
    { connectionKind: 'supabase-session-pooler', port: 5432 },
  );
});

test('rejects the transaction pooler for migrations', () => {
  assert.throws(
    () =>
      inspectMigrationUrl(
        'postgresql://postgres.project:secret@region.pooler.supabase.com:6543/postgres?pgbouncer=true',
      ),
    /transaction pooler/,
  );
});

test('retries only Prisma advisory-lock P1002 failures', () => {
  assert.equal(
    isAdvisoryLockTimeout(
      'Error: P1002\nSELECT pg_advisory_lock(72707369)',
    ),
    true,
  );
  assert.equal(isAdvisoryLockTimeout('Error: P1001'), false);
  assert.equal(isAdvisoryLockTimeout('Error: P1002 network timeout'), false);
});
