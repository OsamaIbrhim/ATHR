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
  // Phase D adds 1 (202608160001_add_promotion_coupon_bundle_tables), so
  // 168 -> 169; this commit deliberately does not yet include
  // 202608160002_add_promotion_coupon_uniqueness_constraints (see that
  // migration's own header comment and the Phase D PR description for why).
  assert.equal(countMigrationFolders(), 169);
  assert.deepEqual(listMigrationFolders().slice(-3), [
    '202608130007_add_sales_tax_snapshot_table',
    '202608130008_add_tax_code_sync_triggers',
    '202608160001_add_promotion_coupon_bundle_tables',
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
