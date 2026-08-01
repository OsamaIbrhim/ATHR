'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../dist');

test('publishes the exact API Contract §6 header names this WP scopes in', () => {
  assert.equal(contracts.REQUEST_ID_HEADER, 'X-Request-Id');
  assert.equal(contracts.CORRELATION_ID_HEADER, 'X-Correlation-Id');
  assert.equal(contracts.IDEMPOTENCY_KEY_HEADER, 'Idempotency-Key');
  assert.equal(contracts.IF_MATCH_HEADER, 'If-Match');
  assert.equal(contracts.ETAG_HEADER, 'ETag');
  assert.equal(contracts.RETRY_AFTER_HEADER, 'Retry-After');
  assert.equal(contracts.CLIENT_OPERATION_ID_HEADER, 'X-Client-Operation-Id');
});

test('ATHR_HEADERS groups exactly the seven in-scope header constants', () => {
  const values = Object.values(contracts.ATHR_HEADERS).sort();
  assert.deepEqual(values, [
    'ETag',
    'Idempotency-Key',
    'If-Match',
    'Retry-After',
    'X-Client-Operation-Id',
    'X-Correlation-Id',
    'X-Request-Id',
  ]);
});

test('envelope/error interfaces are compile-time only (no accidental runtime export)', () => {
  for (const name of ['QueryEnvelope', 'ListEnvelope', 'CommandSuccessEnvelope', 'CommandAcceptedEnvelope', 'ErrorEnvelope', 'ErrorDetail']) {
    assert.equal(contracts[name], undefined, `${name} must stay a pure type, not a runtime export`);
  }
});
