import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SCALE_BARCODE_CONFIG,
  ean13CheckDigit,
  isValidEan13,
  parseScaleBarcode,
} from './scale-barcode';

const on = { ...DEFAULT_SCALE_BARCODE_CONFIG, enabled: true };
const withCheck = (first12: string) => first12 + ean13CheckDigit(first12);

test('EAN-13 checksum accepts real codes and rejects a wrong digit', () => {
  assert.equal(isValidEan13('4006381333931'), true);
  assert.equal(isValidEan13('4006381333932'), false);
  assert.equal(isValidEan13('400638133393'), false);
  assert.equal(isValidEan13('abcdefghijklm'), false);
});

test('parses a weight label: prefix 20, PLU 00123, 1.250 kg', () => {
  const reading = parseScaleBarcode(withCheck('200012301250'), on);
  assert.deepEqual(reading, { plu: '2000123', kind: 'weight', value: 1.25 });
});

test('parses a price label with 2 decimals', () => {
  const config = { ...on, value: 'price' as const, decimals: 2 };
  const reading = parseScaleBarcode(withCheck('210004512345'), config);
  assert.deepEqual(reading, { plu: '2100045', kind: 'price', value: 123.45 });
});

test('honours a different item code length', () => {
  const config = { ...on, item_digits: 4 };
  const reading = parseScaleBarcode(withCheck('202001002500'), config);
  assert.deepEqual(reading, { plu: '202001', kind: 'weight', value: 2.5 });
});

test('returns null when disabled, wrong prefix, or bad checksum', () => {
  assert.equal(parseScaleBarcode(withCheck('200012301250'), DEFAULT_SCALE_BARCODE_CONFIG), null);
  assert.equal(parseScaleBarcode(withCheck('300012301250'), on), null);
  assert.equal(parseScaleBarcode('2000123012500', on), null);
});
