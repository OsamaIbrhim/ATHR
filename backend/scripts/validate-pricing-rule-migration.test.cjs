'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPreCheck, runPostCheck } = require('./validate-pricing-rule-migration.cjs');

function noopLog() {}

test('runPreCheck reports variant/product-scoped rows as directly migratable', async () => {
  const runQuery = async (sql) => {
    if (sql.includes(`"is_active" = true`) && sql.includes('count(*)::int AS count') && !sql.includes('GROUP BY')) {
      return [{ count: 2 }];
    }
    if (sql.includes(`"is_active" = false`)) return [{ count: 0 }];
    if (sql.includes("IN ('variant', 'product')")) {
      return [
        { scope_type: 'variant', count: 1 },
        { scope_type: 'product', count: 1 },
      ];
    }
    if (sql.includes("IN ('brand', 'category', 'global')")) return [];
    return [];
  };
  const result = await runPreCheck(runQuery, noopLog);
  assert.equal(result.ok, true);
  assert.equal(result.totalActive, 2);
  assert.equal(result.ambiguousTotal, 0);
  assert.deepEqual(
    result.directlyMigratable.map((r) => r.scope_type).sort(),
    ['product', 'variant'],
  );
});

test('runPreCheck reports brand/category/global-scoped rows as ambiguous, never as a failure', async () => {
  const runQuery = async (sql) => {
    if (sql.includes(`"is_active" = true`) && sql.includes('count(*)::int AS count') && !sql.includes('GROUP BY')) {
      return [{ count: 3 }];
    }
    if (sql.includes(`"is_active" = false`)) return [{ count: 5 }];
    if (sql.includes("IN ('variant', 'product')")) return [];
    if (sql.includes("IN ('brand', 'category', 'global')")) {
      return [
        { scope_type: 'category', count: 2 },
        { scope_type: 'global', count: 1 },
      ];
    }
    return [];
  };
  const result = await runPreCheck(runQuery, noopLog);
  // Ambiguous data is reported, never silently dropped and never a hard
  // failure -- the migration still prices every live variant correctly.
  assert.equal(result.ok, true);
  assert.equal(result.totalInactive, 5);
  assert.equal(result.ambiguousTotal, 3);
  assert.deepEqual(
    result.ambiguous.map((r) => r.scope_type).sort(),
    ['category', 'global'],
  );
});

test('runPostCheck passes when every live variant has exactly one migrated entry', async () => {
  const runQuery = async () => [{ count: 10 }];
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, true);
  assert.equal(result.liveVariants, 10);
  assert.equal(result.migratedEntries, 10);
});

test('runPostCheck fails loud (not a silent pass) when live variants and migrated entries diverge', async () => {
  let call = 0;
  const runQuery = async () => {
    call += 1;
    return call === 1 ? [{ count: 10 }] : [{ count: 7 }];
  };
  const result = await runPostCheck(runQuery, noopLog, noopLog);
  assert.equal(result.ok, false);
  assert.equal(result.liveVariants, 10);
  assert.equal(result.migratedEntries, 7);
});
