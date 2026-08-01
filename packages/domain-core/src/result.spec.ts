import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fail, ok } from './result';
import type { DomainFailure, Result } from './result';

test('ok() produces a success result carrying the value', () => {
  const result = ok(42);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 42);
});

test('fail() produces a failure result carrying the domain failure', () => {
  const failure: DomainFailure = { code: 'SALE_TOTAL_MISMATCH', message: 'Totals do not balance.' };
  const result = fail(failure);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.failure, failure);
});

test('Result is a discriminated union narrowable on `ok`', () => {
  function describe(result: Result<number, DomainFailure>): string {
    if (result.ok) return `value:${result.value}`;
    return `failure:${result.failure.code}`;
  }

  assert.equal(describe(ok(1)), 'value:1');
  assert.equal(describe(fail({ code: 'X', message: 'x' })), 'failure:X');
});
