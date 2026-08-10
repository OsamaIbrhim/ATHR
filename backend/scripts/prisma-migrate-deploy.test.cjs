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
  // WP-008 Phase A (2349895) added 6 migration folders, 147 -> 153, without
  // updating this assertion. The stale count also masked a second staleness:
  // the 202608060001-0006 catalog folders sort after the 202608040110-0112
  // tenant-scoped ones, so the slice list below was wrong too — assert.equal
  // threw first, so the deepEqual never got the chance to fail.
  assert.equal(countMigrationFolders(), 153);
  assert.deepEqual(listMigrationFolders().slice(-3), [
    '202608060004_add_uom_conversion_table',
    '202608060005_add_productvariant_item_type_base_uom',
    '202608060006_add_assortment_table',
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
