import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Percentage, type PercentageWire } from './percentage';

test('constructs Percentage from a canonical rate decimal string', () => {
  const rate = Percentage.fromRate('0.15');
  assert.equal(rate.toWire().rate, '0.150000');
});

test('rejects a non-decimal rate', () => {
  assert.throws(() => Percentage.fromRate('fifteen-percent'), TypeError);
});

test('derives display_percent from rate rather than storing it independently', () => {
  assert.equal(Percentage.fromRate('0.15').toWire().display_percent, '15.0000');
  assert.equal(Percentage.fromRate('0.0725').toWire().display_percent, '7.2500');
});

test('isNegative/isZero/equals reflect the underlying rate', () => {
  assert.equal(Percentage.fromRate('-0.05').isNegative(), true);
  assert.equal(Percentage.fromRate('0').isZero(), true);
  assert.equal(Percentage.fromRate('0.15').equals(Percentage.fromRate('0.15')), true);
  assert.equal(Percentage.fromRate('0.15').equals(Percentage.fromRate('0.16')), false);
});

test('construction is immutable across repeated calls', () => {
  const first = Percentage.fromRate('0.10');
  const second = Percentage.fromRate('0.20');
  assert.equal(first.toWire().rate, '0.100000');
  assert.equal(second.toWire().rate, '0.200000');
});

test('toWire/fromWire round-trips through the PercentageWire shape', () => {
  const original = Percentage.fromRate('0.14');
  const wire: PercentageWire = original.toWire();

  assert.deepEqual(wire, { rate: '0.140000', display_percent: '14.0000' });

  const restored = Percentage.fromWire(wire);
  assert.equal(restored.equals(original), true);
});
