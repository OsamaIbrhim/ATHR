import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allocateProportionally,
  calculateTax,
  cumulativeShare,
  discountAmount,
  isDiscountAboveLimit,
  lineAmount,
  priceSale,
  type SaleLineInput,
} from './sale-pricing';

const exclusive = (unitPrice: string, unitTax: string, qty: string | number = 1, extra: Partial<SaleLineInput> = {}): SaleLineInput => ({
  qty, unitPrice, unitTax, taxRate: '14', taxMode: 'exclusive', ...extra,
});
const inclusive = (unitPrice: string, unitTax: string, qty: string | number = 1, extra: Partial<SaleLineInput> = {}): SaleLineInput => ({
  qty, unitPrice, unitTax, taxRate: '14', taxMode: 'inclusive', ...extra,
});

test('calculateTax: exclusive price adds tax on top, inclusive price extracts it', () => {
  assert.deepEqual(calculateTax('14', 'exclusive', '100.00'), { net: '100.00', tax: '14.00', gross: '114.00' });
  assert.deepEqual(calculateTax('14', 'inclusive', '114.00'), { net: '100.00', tax: '14.00', gross: '114.00' });
  // 100 / 1.14 = 87.7193 -> net 87.72, tax is the remainder so net + tax is exactly the shelf price
  assert.deepEqual(calculateTax('14', 'inclusive', '100.00'), { net: '87.72', tax: '12.28', gross: '100.00' });
  assert.deepEqual(calculateTax('1.5', 'exclusive', '33.33'), { net: '33.33', tax: '0.50', gross: '33.83' });
  assert.deepEqual(calculateTax('0', 'inclusive', '19.99'), { net: '19.99', tax: '0.00', gross: '19.99' });
});

test('lineAmount rounds half up for a fractional quantity', () => {
  assert.equal(lineAmount('10.00', '1.250'), '12.50');
  assert.equal(lineAmount('0.15', '0.500'), '0.08');
  assert.equal(lineAmount('33.33', 3), '99.99');
});

test('a sale without discounts keeps the quoted amounts exactly (unit x qty)', () => {
  const sale = priceSale([exclusive('100.00', '14.00', 2), exclusive('9.99', '1.40', 3)]);
  assert.deepEqual(sale.totals, { subtotal: '229.97', discountTotal: '0.00', taxTotal: '32.20', total: '262.17' });
  assert.equal(sale.lines[1]!.net, '29.97');
  assert.equal(sale.lines[1]!.tax, '4.20');
});

test('percent discount on a tax-inclusive price comes off the shelf price, tax is taken after it', () => {
  const line = priceSale([inclusive('100.00', '14.00', 1, { discount: { type: 'percent', value: 10 } })]).lines[0]!;
  // shelf 114.00, 10% = 11.40 -> customer pays 102.60 = net 90.00 + tax 12.60
  assert.equal(line.discountAuthored, '11.40');
  assert.equal(line.net, '90.00');
  assert.equal(line.tax, '12.60');
  assert.equal(line.gross, '102.60');
  assert.equal(line.discountNet, '10.00');
});

test('amount discount on a tax-exclusive price comes off the net, tax follows the smaller net', () => {
  const sale = priceSale([exclusive('100.00', '14.00', 1, { discount: { type: 'amount', value: 20 } })]);
  assert.equal(sale.lines[0]!.net, '80.00');
  assert.equal(sale.lines[0]!.tax, '11.20');
  assert.deepEqual(sale.totals, { subtotal: '100.00', discountTotal: '20.00', taxTotal: '11.20', total: '91.20' });
});

test('amount discount on a tax-inclusive price is what the customer saves', () => {
  const sale = priceSale([inclusive('100.00', '14.00', 1, { discount: { type: 'amount', value: 14 } })]);
  // shelf 114 - 14 = 100 payable: net 87.72 + tax 12.28
  assert.equal(sale.lines[0]!.gross, '100.00');
  assert.equal(sale.totals.total, '100.00');
  assert.equal(sale.lines[0]!.discountNet, '12.28');
});

test('a discount is never more than the line, and a 100% discount leaves a zero base and zero tax', () => {
  const sale = priceSale([exclusive('50.00', '7.00', 1, { discount: { type: 'amount', value: 500 } })]);
  assert.equal(sale.lines[0]!.net, '0.00');
  assert.equal(sale.lines[0]!.tax, '0.00');
  assert.equal(sale.totals.total, '0.00');
  assert.equal(priceSale([inclusive('50.00', '7.00', 1, { discount: { type: 'percent', value: 100 } })]).totals.total, '0.00');
  assert.equal(discountAmount({ type: 'percent', value: 150 }, '10.00'), '10.00');
  assert.equal(discountAmount({ type: 'amount', value: -5 }, '10.00'), '0.00');
});

test('invoice discount is spread by what each line has left; the last line takes the rounding', () => {
  const plain = (price: string) => ({ qty: 1, unitPrice: price, unitTax: '0.00', taxRate: '0', taxMode: 'exclusive' as const });
  const sale = priceSale([plain('10.00'), plain('10.00'), plain('10.00')], { type: 'amount', value: 10 });
  assert.deepEqual(sale.lines.map((line) => line.discountAuthored), ['3.33', '3.33', '3.34']);
  assert.equal(sale.totals.total, '20.00');

  // proportional to what is left after the line's own discount
  const mixed = priceSale(
    [plain('100.00'), { ...plain('100.00'), discount: { type: 'percent', value: 50 } }],
    { type: 'percent', value: 10 },
  );
  assert.deepEqual(mixed.lines.map((line) => line.discountAuthored), ['10.00', '55.00']);
  assert.equal(mixed.totals.total, '135.00');
});

test('the rounding difference goes to the last line that still has an amount', () => {
  assert.deepEqual(allocateProportionally(10n, [0n, 5n, 5n, 0n]), [0n, 5n, 5n, 0n]);
  assert.deepEqual(allocateProportionally(1n, [1n, 1n, 1n]), [0n, 0n, 1n]);
  assert.deepEqual(allocateProportionally(5n, [0n, 0n]), [0n, 0n]);
});

test('an invoice discount on tax-inclusive lines is taxed after the discount, line by line', () => {
  const sale = priceSale(
    [inclusive('100.00', '14.00'), inclusive('50.00', '7.00')],
    { type: 'amount', value: 11.4 },
  );
  // shelf 114 + 57 = 171, discount 11.40 split 7.60 / 3.80
  assert.deepEqual(sale.lines.map((line) => line.discountAuthored), ['7.60', '3.80']);
  assert.equal(sale.lines[0]!.gross, '106.40');
  assert.equal(sale.lines[1]!.gross, '53.20');
  assert.equal(sale.totals.total, '159.60');
  assert.equal(
    (Number(sale.totals.subtotal) - Number(sale.totals.discountTotal) + Number(sale.totals.taxTotal)).toFixed(2),
    sale.totals.total,
  );
});

test('isDiscountAboveLimit is exact at the limit and counts the invoice share', () => {
  const at = priceSale([exclusive('100.00', '14.00', 1, { discount: { type: 'percent', value: 10 } })]);
  assert.equal(isDiscountAboveLimit(at.lines, 10), false);
  const over = priceSale([exclusive('100.00', '14.00', 1, { discount: { type: 'percent', value: 10.01 } })]);
  assert.equal(isDiscountAboveLimit(over.lines, 10), true);
  const combined = priceSale([exclusive('100.00', '14.00', 1, { discount: { type: 'percent', value: 6 } })], { type: 'percent', value: 6 });
  assert.equal(isDiscountAboveLimit(combined.lines, 10), true);
  assert.equal(isDiscountAboveLimit(priceSale([exclusive('100.00', '14.00')]).lines, 0), false);
});

test('cumulativeShare: the parts of a line returned in several goes add up to the line', () => {
  const parts = [
    cumulativeShare('10.00', 3, 0, 1),
    cumulativeShare('10.00', 3, 1, 1),
    cumulativeShare('10.00', 3, 2, 1),
  ];
  assert.deepEqual(parts, ['3.33', '3.34', '3.33']);
  assert.equal(parts.reduce((sum, part) => sum + Number(part), 0).toFixed(2), '10.00');
  assert.equal(cumulativeShare('10.00', 3, 0, 3), '10.00');
  assert.equal(cumulativeShare('90.00', '1.500', 0, '0.500'), '30.00');
});
