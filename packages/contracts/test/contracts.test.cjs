'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../dist');

test('publishes stable ATHR protocol identifiers', () => {
  assert.equal(contracts.API_CONTRACT_VERSION, 1);
  assert.equal(contracts.POS_PROTOCOL_VERSION, 2);
});
