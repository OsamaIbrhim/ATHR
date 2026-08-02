import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BusinessDate, UtcTimestamp } from './datetime';

test('constructs UtcTimestamp from a Z-suffixed ISO-8601 instant', () => {
  const timestamp = UtcTimestamp.fromIso('2026-08-01T10:00:00.000Z');
  assert.equal(timestamp.toIso(), '2026-08-01T10:00:00.000Z');
});

test('rejects a naive (no offset) timestamp', () => {
  assert.throws(() => UtcTimestamp.fromIso('2026-08-01T10:00:00'), TypeError);
});

test('rejects a local-offset timestamp', () => {
  assert.throws(() => UtcTimestamp.fromIso('2026-08-01T12:00:00+02:00'), TypeError);
});

test('rejects a malformed instant', () => {
  assert.throws(() => UtcTimestamp.fromIso('not-a-date'), TypeError);
});

test('UtcTimestamp.now uses the injected clock deterministically', () => {
  const fixed = new Date('2026-08-01T00:00:00.000Z');
  const timestamp = UtcTimestamp.now({ now: () => fixed });
  assert.equal(timestamp.toIso(), '2026-08-01T00:00:00.000Z');
});

test('isBefore/isAfter/equals compare instants correctly', () => {
  const earlier = UtcTimestamp.fromIso('2026-08-01T00:00:00Z');
  const later = UtcTimestamp.fromIso('2026-08-01T01:00:00Z');
  assert.equal(earlier.isBefore(later), true);
  assert.equal(later.isAfter(earlier), true);
  assert.equal(earlier.equals(UtcTimestamp.fromIso('2026-08-01T00:00:00.000Z')), true);
});

test('constructs BusinessDate from a valid calendar date and IANA timezone', () => {
  const date = BusinessDate.of('2026-08-01', 'Africa/Cairo');
  assert.equal(date.toIsoDate(), '2026-08-01');
  assert.equal(date.getTimezone(), 'Africa/Cairo');
});

test('rejects a malformed calendar date string', () => {
  assert.throws(() => BusinessDate.of('2026/08/01', 'Africa/Cairo'), TypeError);
});

test('rejects an impossible calendar date', () => {
  assert.throws(() => BusinessDate.of('2026-02-30', 'Africa/Cairo'), RangeError);
});

test('rejects an invalid IANA timezone id', () => {
  assert.throws(() => BusinessDate.of('2026-08-01', 'Not/AZone'), RangeError);
});

test('BusinessDate and UtcTimestamp remain distinct, non-interchangeable types', () => {
  const date = BusinessDate.of('2026-08-01', 'Africa/Cairo') as unknown as Record<string, unknown>;
  const timestamp = UtcTimestamp.fromIso('2026-08-01T00:00:00Z') as unknown as Record<
    string,
    unknown
  >;
  assert.equal(typeof date.toIsoDate, 'function');
  assert.equal(typeof timestamp.toIsoDate, 'undefined');
  assert.equal(typeof timestamp.isBefore, 'function');
  assert.equal(typeof date.isBefore, 'undefined');
});
