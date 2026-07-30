'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixedClock, deterministicId } = require('../dist');

test('provides deterministic test primitives', () => {
  const clock = createFixedClock('2026-01-01T00:00:00.000Z');

  assert.equal(clock.now().toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(deterministicId('tenant', 12), 'tenant-000012');
});
