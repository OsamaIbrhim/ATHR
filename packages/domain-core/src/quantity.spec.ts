import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QuantityWire as ContractsQuantityWire } from '@athr/contracts';
import { Quantity, parseUnitOfMeasureId } from './quantity';

const kg = parseUnitOfMeasureId('uom-kg');

test('constructs Quantity from a valid decimal value and unit', () => {
  const quantity = Quantity.of('12.500', kg, 'KG');
  assert.equal(quantity.toWire().value, '12.500');
  assert.equal(quantity.getUnitCode(), 'KG');
});

test('rejects a non-decimal value', () => {
  assert.throws(() => Quantity.of('twelve', kg, 'KG'), TypeError);
});

test('rejects an empty unit code', () => {
  assert.throws(() => Quantity.of('1', kg, '   '), TypeError);
});

test('rejects an empty unit id at construction', () => {
  assert.throws(() => parseUnitOfMeasureId('   '), Error);
});

test('scale-validates to the default 3 decimal places, rounding half up', () => {
  assert.equal(Quantity.of('1.2345', kg, 'KG').toWire().value, '1.235');
});

test('isNegative/isZero/equals reflect the underlying scaled value', () => {
  assert.equal(Quantity.of('-1', kg, 'KG').isNegative(), true);
  assert.equal(Quantity.of('0', kg, 'KG').isZero(), true);
  assert.equal(
    Quantity.of('2.5', kg, 'KG').equals(Quantity.of('2.5', kg, 'KG')),
    true,
  );
  assert.equal(
    Quantity.of('2.5', kg, 'KG').equals(Quantity.of('2.5', kg, 'G')),
    false,
  );
});

test('construction never mutates a reused unit id', () => {
  const first = Quantity.of('1', kg, 'KG');
  const second = Quantity.of('2', kg, 'KG');
  assert.equal(first.getUnitId(), kg);
  assert.equal(second.getUnitId(), kg);
  assert.notEqual(first.toWire().value, second.toWire().value);
});

test('toWire/fromWire round-trip against the exact @athr/contracts QuantityWire shape', () => {
  const original = Quantity.of('5.000', kg, 'KG');
  const wire: ContractsQuantityWire = original.toWire();

  assert.deepEqual(wire, { value: '5.000', unit_id: 'uom-kg', unit_code: 'KG' });

  const restored = Quantity.fromWire(wire);
  assert.equal(restored.equals(original), true);
});
