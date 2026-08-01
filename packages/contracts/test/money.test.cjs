'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../dist');

test('Money/Quantity/Percentage wire types are pure interfaces (types, not classes with logic)', () => {
  for (const name of ['MoneyWire', 'QuantityWire', 'PercentageWire']) {
    assert.equal(contracts[name], undefined, `${name} must stay a pure type, not a runtime class`);
  }
});

test('PageRequest/PageMeta pagination types are pure interfaces', () => {
  for (const name of ['PageRequest', 'PageMeta']) {
    assert.equal(contracts[name], undefined, `${name} must stay a pure type, not a runtime class`);
  }
});
