'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPreCheck, runPostCheck } = require('./validate-tax-code-migration.cjs');

function noopLog() {}

/**
 * The queries are matched on distinctive fragments rather than exact text, so
 * a whitespace change in the tool does not silently turn a stub into `[]` and
 * make a failing case look like a passing one.
 */
function stubQuery(responses) {
  return async (sql) => {
    // `WITH observed AS` is matched FIRST: the post-check's mismatch query
    // also selects `FROM "PriceBookEntry" e ... GROUP BY 1, 2`, so a looser
    // ordering here silently returns the pre-check's stub and makes a failing
    // case look like a passing one.
    if (sql.includes('WITH observed AS')) return responses.mismatches ?? [];
    if (sql.includes('FROM "PriceBookEntry" e') && sql.includes('GROUP BY 1, 2')) {
      return responses.liveRates ?? [];
    }
    if (sql.includes('FROM "PricingRule"')) return responses.legacyRates ?? [];
    if (sql.includes('JOIN "Product" p ON p."tenant_id" = t."id"')) {
      return responses.productlessTenants ?? [];
    }
    if (sql.includes('"tax_category_id" IS NULL')) {
      return [{ count: responses.uncategorised ?? 0 }];
    }
    if (sql.includes('FROM "TaxCode" WHERE "status"')) return [{ count: responses.activeCodes ?? 1 }];
    if (sql.includes('FROM "TaxCategory"')) return [{ count: responses.categories ?? 1 }];
    throw new Error(`unstubbed query: ${sql.slice(0, 80)}`);
  };
}

test('runPreCheck passes when every tenant charges exactly one rate', async () => {
  const result = await runPreCheck(
    stubQuery({
      liveRates: [{ tenant_id: 'tenant-a', rate: '14.00', entries: 31 }],
      legacyRates: [{ tenant_id: 'tenant-a', rate: '14.00', rules: 3 }],
    }),
    noopLog,
    noopLog,
  );
  assert.equal(result.ok, true);
  assert.equal(result.totalEntries, 31);
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.ratesByTenant, { 'tenant-a': '14.00' });
});

test('runPreCheck FAILS, naming the tenant, when one tenant charges two distinct rates', async () => {
  // This is the case CLAUDE.md §6 exists for: it must never be silently
  // collapsed to whichever rate happens to be more common.
  const errors = [];
  const result = await runPreCheck(
    stubQuery({
      liveRates: [
        { tenant_id: 'tenant-a', rate: '14.00', entries: 20 },
        { tenant_id: 'tenant-a', rate: '5.00', entries: 3 },
        { tenant_id: 'tenant-b', rate: '14.00', entries: 9 },
      ],
    }),
    noopLog,
    (message) => errors.push(message),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.ambiguous, ['tenant-a']);
  assert.ok(errors.some((line) => line.includes('tenant-a')));
  assert.ok(errors.some((line) => line.includes('5.00')));
  assert.ok(errors.some((line) => line.includes('14.00')));
  // The unaffected tenant must not be dragged into the failure report.
  assert.ok(!errors.some((line) => line.includes('tenant-b')));
});

test('runPreCheck reports a tenant with products but no live rate as INFO, not a failure', async () => {
  const logs = [];
  const result = await runPreCheck(
    stubQuery({
      liveRates: [{ tenant_id: 'tenant-a', rate: '14.00', entries: 4 }],
      productlessTenants: [{ tenant_id: 'tenant-c', products: 7 }],
    }),
    (message) => logs.push(message),
    noopLog,
  );
  assert.equal(result.ok, true);
  const info = logs.find((line) => line.includes('tenant-c'));
  assert.ok(info, 'expected the unpriced tenant to be reported');
  assert.ok(info.includes('TAX_NO_ACTIVE_CODE'));
  assert.ok(info.includes('NO TaxCode'));
});

test('runPreCheck passes on an empty database (clean-migration CI path)', async () => {
  const result = await runPreCheck(stubQuery({}), noopLog, noopLog);
  assert.equal(result.ok, true);
  assert.equal(result.totalEntries, 0);
});

test('runPostCheck FAILS when any Product still has no tax category', async () => {
  const errors = [];
  const result = await runPostCheck(
    stubQuery({ uncategorised: 4 }),
    noopLog,
    (message) => errors.push(message),
  );
  assert.equal(result.ok, false);
  assert.equal(result.uncategorised, 4);
  assert.ok(errors.some((line) => line.includes('BR-TAX-201')));
});

test('runPostCheck FAILS when a migrated rate does not match what was being charged', async () => {
  const errors = [];
  const result = await runPostCheck(
    stubQuery({
      mismatches: [
        { tenant_id: 'tenant-a', observed_rate: '14.00', migrated_rate: '20.0000' },
      ],
    }),
    noopLog,
    (message) => errors.push(message),
  );
  assert.equal(result.ok, false);
  assert.ok(errors.some((line) => line.includes('tenant-a')));
  assert.ok(errors.some((line) => line.includes('14.00') && line.includes('20.0000')));
});

test('runPostCheck FAILS when a tenant got no TaxCode at all', async () => {
  const result = await runPostCheck(
    stubQuery({
      mismatches: [{ tenant_id: 'tenant-a', observed_rate: '14.00', migrated_rate: '(none)' }],
    }),
    noopLog,
    noopLog,
  );
  assert.equal(result.ok, false);
});

test('runPostCheck passes when every product is categorised and every rate carried over', async () => {
  const result = await runPostCheck(
    stubQuery({ uncategorised: 0, mismatches: [], activeCodes: 2, categories: 2 }),
    noopLog,
    noopLog,
  );
  assert.equal(result.ok, true);
  assert.equal(result.activeCodes, 2);
});
