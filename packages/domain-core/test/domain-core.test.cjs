'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOpaqueId } = require('../dist');

test('rejects empty opaque IDs at their construction boundary', () => {
  assert.equal(parseOpaqueId(' tenant-1 ', 'Tenant'), 'tenant-1');
  assert.throws(() => parseOpaqueId('   ', 'Tenant'), /must not be empty/);
});
