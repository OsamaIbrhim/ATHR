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
  assert.equal(countMigrationFolders(), 30);
  assert.deepEqual(listMigrationFolders().slice(-3), [
    '202607290001_sales_inventory_single_writer',
    '202607290002_inventory_movement_negative_balance',
    '202607290003_inventory_cost_negative_balance',
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
