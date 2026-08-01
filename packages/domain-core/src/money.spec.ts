import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MoneyWire as ContractsMoneyWire } from '@athr/contracts';
import { Money } from './money';
import { Percentage } from './percentage';

test('constructs Money from a valid decimal string and currency', () => {
  const money = Money.of('19.99', 'EGP');
  assert.equal(money.toWire().amount, '19.99');
  assert.equal(money.getCurrency(), 'EGP');
});

test('rejects a non-decimal amount', () => {
  assert.throws(() => Money.of('nineteen', 'EGP'), TypeError);
});

test('rejects an unsupported currency code', () => {
  assert.throws(() => Money.of('10.00', 'GBP'), RangeError);
});

test('0.1 + 0.2 equals exactly 0.30 (no IEEE-754 float trap)', () => {
  const sum = Money.of('0.10', 'EGP').add(Money.of('0.20', 'EGP'));
  assert.equal(sum.toWire().amount, '0.30');
});

test('rounds half up at the currency scale boundary (100.005 -> 100.01)', () => {
  assert.equal(Money.of('100.005', 'EGP').toWire().amount, '100.01');
});

test('rounds half away from zero for negative boundary values (-0.005 -> -0.01)', () => {
  assert.equal(Money.of('-0.005', 'EGP').toWire().amount, '-0.01');
});

test('add/subtract return new instances and never mutate the operands', () => {
  const left = Money.of('10.00', 'EGP');
  const right = Money.of('2.50', 'EGP');
  const sum = left.add(right);
  const difference = left.subtract(right);

  assert.equal(left.toWire().amount, '10.00');
  assert.equal(right.toWire().amount, '2.50');
  assert.equal(sum.toWire().amount, '12.50');
  assert.equal(difference.toWire().amount, '7.50');
});

test('rejects combining Money of different currencies', () => {
  assert.throws(() => Money.of('10.00', 'EGP').add(Money.of('10.00', 'USD')), RangeError);
});

test('multiplyByRate applies a Percentage without float arithmetic', () => {
  const tax = Money.of('100.00', 'EGP').multiplyByRate(Percentage.fromRate('0.14'));
  assert.equal(tax.toWire().amount, '14.00');
});

test('isNegative/isZero/equals reflect the underlying minor units', () => {
  assert.equal(Money.of('-1.00', 'EGP').isNegative(), true);
  assert.equal(Money.of('0.00', 'EGP').isZero(), true);
  assert.equal(Money.of('5.00', 'EGP').equals(Money.of('5.00', 'EGP')), true);
  assert.equal(Money.of('5.00', 'EGP').equals(Money.of('5.00', 'USD')), false);
});

test('toWire/fromWire round-trip against the exact @athr/contracts MoneyWire shape', () => {
  const original = Money.of('42.50', 'SAR');
  const wire: ContractsMoneyWire = original.toWire();

  assert.deepEqual(wire, { amount: '42.50', currency: 'SAR' });

  const restored = Money.fromWire(wire);
  assert.equal(restored.equals(original), true);
});
