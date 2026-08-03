'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const errorRegistry = require('../dist');

test('publishes the exact Error Catalog §5 category list', () => {
  assert.deepEqual(
    [...errorRegistry.ERROR_CATEGORIES],
    [
      'request_invalid',
      'authentication',
      'authorization',
      'resource_not_found',
      'state_conflict',
      'business_rule',
      'precondition',
      'concurrency',
      'idempotency',
      'entitlement',
      'limit',
      'rate_limit',
      'dependency',
      'provider',
      'temporarily_unavailable',
      'outcome_unknown',
      'partial_completion',
      'manual_intervention',
      'data_integrity',
      'internal',
    ],
  );
});

test('publishes the exact Error Catalog §7 retry-mode list', () => {
  assert.deepEqual(
    [...errorRegistry.RETRY_MODES],
    [
      'never',
      'same_request_immediately',
      'same_idempotency_key_after_delay',
      'after_refresh',
      'after_reauthentication',
      'after_step_up',
      'after_approval',
      'after_user_action',
      'after_dependency_recovery',
      'manual_review_only',
      'poll_operation',
    ],
  );
});

test('publishes the exact Error Catalog §6 outcome-certainty list', () => {
  assert.deepEqual(
    [...errorRegistry.OUTCOME_CERTAINTIES],
    ['no_effect', 'committed', 'pending', 'partial', 'unknown', 'not_applicable'],
  );
});

test('publishes the exact Error Catalog §8 severity list', () => {
  assert.deepEqual([...errorRegistry.ERROR_SEVERITIES], ['info', 'warning', 'error', 'critical']);
});

test('every code group is registered under ERROR_REGISTRY with matching metadata', () => {
  for (const group of [
    errorRegistry.COMMON_ERROR_CODES,
    errorRegistry.AUTH_ERROR_CODES,
    errorRegistry.INTERNAL_ERROR_CODES,
    errorRegistry.IDENTITY_ERROR_CODES,
  ]) {
    for (const definition of group) {
      assert.deepEqual(errorRegistry.ERROR_REGISTRY[definition.code], definition);
      assert.deepEqual(errorRegistry.getErrorMetadata(definition.code), definition);
    }
  }
});

test('getErrorMetadata throws a clear developer-time error for an unregistered code', () => {
  assert.throws(
    () => errorRegistry.getErrorMetadata('SOME_CODE_NOBODY_REGISTERED'),
    /Unregistered ATHR error code "SOME_CODE_NOBODY_REGISTERED"/,
  );
});

test('ERROR_REGISTRY is frozen (cannot be mutated at runtime)', () => {
  assert.equal(Object.isFrozen(errorRegistry.ERROR_REGISTRY), true);
});

test('scoped auth codes match the Backend JWT-guard-reachable set exactly', () => {
  const codes = errorRegistry.AUTH_ERROR_CODES.map((definition) => definition.code).sort();
  assert.deepEqual(codes, [
    'ACCESS_TOKEN_EXPIRED',
    'ACCESS_TOKEN_INVALID',
    'AUTHENTICATION_REQUIRED',
    'PERMISSION_DENIED',
    'RESOURCE_NOT_FOUND',
    'SESSION_REVOKED',
  ]);
});

test('scoped internal codes match Error Catalog §24 exactly', () => {
  const codes = errorRegistry.INTERNAL_ERROR_CODES.map((definition) => definition.code).sort();
  assert.deepEqual(codes, ['INTERNAL_ERROR', 'UNEXPECTED_PROCESSING_ERROR']);
});

test('scoped identity codes match the WP-006 identity module reachable set exactly', () => {
  const codes = errorRegistry.IDENTITY_ERROR_CODES.map((definition) => definition.code).sort();
  assert.deepEqual(codes, [
    'ACCESS_SCOPE_REFERENCE_REQUIRED',
    'ACCESS_SCOPE_REQUIRED',
    'INVITATION_ALREADY_ACCEPTED',
    'INVITATION_EXPIRED',
    'INVITATION_NOT_FOUND',
    'INVITATION_TOKEN_INVALID',
    'LAST_OWNER_SAFEGUARD_VIOLATION',
    'MEMBERSHIP_ALREADY_EXISTS',
    'MEMBERSHIP_INVALID_STATE_TRANSITION',
    'MEMBERSHIP_NOT_FOUND',
    'SUPPORT_ACCESS_CONSENT_REQUIRED',
    'SUPPORT_ACCESS_GRANT_EXPIRED',
    'SUPPORT_ACCESS_GRANT_NOT_FOUND',
    'TENANT_CONTEXT_MISMATCH',
    'TENANT_CONTEXT_UNRESOLVABLE',
  ]);
});

test('every registered code carries HTTP status, retry mode, outcome and severity (Error Catalog §29)', () => {
  for (const [code, metadata] of Object.entries(errorRegistry.ERROR_REGISTRY)) {
    assert.equal(metadata.code, code);
    assert.equal(typeof metadata.defaultHttpStatus, 'number');
    assert.equal(errorRegistry.RETRY_MODES.includes(metadata.retryMode), true);
    assert.equal(errorRegistry.OUTCOME_CERTAINTIES.includes(metadata.outcome), true);
    assert.equal(errorRegistry.ERROR_CATEGORIES.includes(metadata.category), true);
    assert.equal(errorRegistry.ERROR_SEVERITIES.includes(metadata.severity), true);
    assert.equal(typeof metadata.auditRequired, 'boolean');
  }
});
