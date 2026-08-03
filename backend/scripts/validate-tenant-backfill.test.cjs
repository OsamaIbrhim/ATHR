'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPreCheck, runPostCheck, ALL_TABLES } = require('./validate-tenant-backfill.cjs');

function noopLog() {}

// Fake runQuery: returns empty results for every query unless a table-specific
// override is registered. Good enough to drive the pure detection logic
// without a real database.
function fakeRunQuery(overrides = {}) {
  return async (sql) => {
    for (const [table, respond] of Object.entries(overrides)) {
      if (sql.includes(`"${table}"`)) return respond(sql);
    }
    if (sql.includes('count(*)::int AS count')) return [{ count: 0 }];
    return [];
  };
}

test('runPreCheck passes when every chain resolves and reports unconditional tables', async () => {
  const runQuery = fakeRunQuery({
    Supplier: (sql) => (sql.includes('count(*)::int AS count') ? [{ count: 3 }] : []),
  });
  const result = await runPreCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test('runPreCheck fails loud (not just warns) when a genuinely unassignable row exists', async () => {
  const runQuery = fakeRunQuery({
    SalesInvoice: (sql) => {
      if (sql.includes('NOT EXISTS')) {
        return [{ id: 'orphan-invoice-1' }];
      }
      return [{ count: 0 }];
    },
  });
  const result = await runPreCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].table, 'SalesInvoice');
  assert.deepEqual(result.failures[0].ids, ['orphan-invoice-1']);
});

test('runPreCheck reports every ambiguous table, not just the first', async () => {
  const runQuery = fakeRunQuery({
    SalesInvoice: (sql) => (sql.includes('NOT EXISTS') ? [{ id: 'orphan-invoice-1' }] : [{ count: 0 }]),
    Shift: (sql) => (sql.includes('NOT EXISTS') ? [{ id: 'orphan-shift-1' }, { id: 'orphan-shift-2' }] : [{ count: 0 }]),
  });
  const result = await runPreCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, false);
  const tables = result.failures.map((f) => f.table).sort();
  assert.deepEqual(tables, ['SalesInvoice', 'Shift']);
});

test('runPostCheck passes when zero rows have a null tenant_id', async () => {
  const runQuery = fakeRunQuery();
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, true);
});

test('runPostCheck fails loud when a row was left with tenant_id IS NULL', async () => {
  const runQuery = fakeRunQuery({
    Customer: () => [{ id: 'unbackfilled-customer-1' }],
  });
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].table, 'Customer');
  assert.deepEqual(result.failures[0].ids, ['unbackfilled-customer-1']);
});

test('every classified table is covered exactly once', () => {
  const unique = new Set(ALL_TABLES);
  assert.equal(unique.size, ALL_TABLES.length, 'no table should be double-classified');
  assert.equal(ALL_TABLES.length, 32);
});
