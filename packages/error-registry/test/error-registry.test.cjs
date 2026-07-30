'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defineError } = require('../dist');

test('freezes registered error metadata', () => {
  const descriptor = defineError({
    code: 'ATHR_TEST_ERROR',
    retryMode: 'never',
    outcome: 'known-failure',
    localizationKey: 'errors.athrTest',
  });

  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(descriptor.code, 'ATHR_TEST_ERROR');
});
