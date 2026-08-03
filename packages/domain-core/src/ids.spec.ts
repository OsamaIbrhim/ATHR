import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseAggregateVersion,
  parseCausationId,
  parseClientOperationId,
  parseCorrelationId,
  parseIdempotencyKey,
  parseInvitationId,
  parseMembershipId,
  parseOpaqueId,
  parseTenantId,
} from './ids';

test('parseOpaqueId trims and accepts a non-empty value', () => {
  assert.equal(parseOpaqueId(' tenant-1 ', 'Tenant'), 'tenant-1');
});

test('parseOpaqueId rejects an empty value', () => {
  assert.throws(() => parseOpaqueId('   ', 'Tenant'), /must not be empty/);
});

test('concrete ID parsers reject empty values with a brand-specific message', () => {
  assert.throws(() => parseTenantId(''), /Tenant ID must not be empty/);
  assert.throws(() => parseIdempotencyKey(''), /IdempotencyKey ID must not be empty/);
  assert.throws(() => parseClientOperationId(''), /ClientOperationId ID must not be empty/);
  assert.throws(() => parseCorrelationId(''), /CorrelationId ID must not be empty/);
  assert.throws(() => parseCausationId(''), /CausationId ID must not be empty/);
  assert.throws(() => parseMembershipId(''), /Membership ID must not be empty/);
  assert.throws(() => parseInvitationId(''), /Invitation ID must not be empty/);
});

test('MembershipId and InvitationId parsers accept and normalize a valid value', () => {
  assert.equal(parseMembershipId(' membership-1 '), 'membership-1');
  assert.equal(parseInvitationId(' invitation-1 '), 'invitation-1');
});

test('concrete ID parsers accept and normalize a valid value', () => {
  assert.equal(parseTenantId(' tenant-42 '), 'tenant-42');
});

test('parseAggregateVersion accepts a positive safe integer', () => {
  assert.equal(parseAggregateVersion(1), 1);
  assert.equal(parseAggregateVersion(42), 42);
});

test('parseAggregateVersion rejects zero, negative and non-integer values', () => {
  assert.throws(() => parseAggregateVersion(0), RangeError);
  assert.throws(() => parseAggregateVersion(-1), RangeError);
  assert.throws(() => parseAggregateVersion(1.5), RangeError);
});
