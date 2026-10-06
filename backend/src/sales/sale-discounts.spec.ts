import { cleanDiscount, discountFingerprint, discountLimitPercent, priceSaleLines } from './sale-discounts';

describe('cleanDiscount', () => {
  it('keeps a usable discount and rounds it (percent to 4 places, amount to 2)', () => {
    expect(cleanDiscount({ type: 'percent', value: 12.345678 })).toEqual({ type: 'percent', value: 12.3457 });
    expect(cleanDiscount({ type: 'amount', value: '5.556' })).toEqual({ type: 'amount', value: 5.56 });
  });

  it.each([
    null,
    undefined,
    5,
    'x',
    {},
    { type: 'amount' },
    { type: 'bogus', value: 1 },
    { type: 'amount', value: -1 },
    { type: 'amount', value: 0 },
    { type: 'percent', value: 'NaN' },
    { type: 'amount', value: 0.001 },
  ])('turns %p into no discount instead of refusing the sale', (value) => {
    expect(cleanDiscount(value)).toBeUndefined();
  });

  it('hashes a discount in a canonical form', () => {
    expect(discountFingerprint({ type: 'percent', value: 10 })).toEqual({ type: 'percent', value: '10.0000' });
    expect(discountFingerprint({ type: 'amount', value: 5 })).toEqual({ type: 'amount', value: '5.00' });
  });
});

describe('priceSaleLines', () => {
  const line = (variantId: string, extra = {}) => ({
    variantId,
    qty: 2,
    unitPrice: '150',
    unitTax: '21',
    taxRate: '14',
    taxMode: 'exclusive' as const,
    ...extra,
  });

  it('keeps the quoted amounts of a sale without discount', () => {
    const priced = priceSaleLines([line('a')]);
    expect(priced.subtotal.toString()).toBe('300');
    expect(priced.taxTotal.toString()).toBe('42');
    expect(priced.total.toString()).toBe('342');
    expect(priced.discountTotal.toString()).toBe('0');
  });

  it('takes a line discount off the price and recomputes the tax on what is left', () => {
    const priced = priceSaleLines([line('a', { discount: { type: 'percent', value: 10 } })]);
    const row = priced.byVariant.get('a')!;
    expect([row.discount.toString(), row.net.toString(), row.tax.toString()]).toEqual(['30', '270', '37.8']);
    expect(priced.total.toString()).toBe('307.8');
  });

  it('rolls several lines of one variant into one row, each discounted on its own', () => {
    const priced = priceSaleLines([
      line('a', { qty: 1, discount: { type: 'amount', value: 10 } }),
      line('a', { qty: 1 }),
      line('b', { qty: 1 }),
    ]);
    expect(priced.byVariant.size).toBe(2);
    expect(priced.byVariant.get('a')!.discount.toString()).toBe('10');
    expect(priced.byVariant.get('a')!.net.toString()).toBe('290');
  });

  it('spreads an invoice discount over the lines and loses no cent', () => {
    const priced = priceSaleLines([line('a', { qty: 1 }), line('b', { qty: 1 }), line('c', { qty: 1 })], {
      type: 'amount',
      value: 10,
    });
    const shares = [...priced.byVariant.values()].map((row) => Number(row.discount.toString()));
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(10, 5);
    expect(priced.discountTotal.toString()).toBe('10');
  });
});

describe('discountLimitPercent', () => {
  it('is nothing without apply, the tenant limit with it, and everything with override', () => {
    expect(discountLimitPercent(new Set(['sales.sale.create']), 10)).toBe(0);
    expect(discountLimitPercent(new Set(['sales.discount.apply']), 10)).toBe(10);
    expect(discountLimitPercent(new Set(['sales.discount.apply', 'sales.discount.override']), 10)).toBe(100);
  });

  it('gives a staff member the server cannot identify the tenant limit', () => {
    expect(discountLimitPercent(null, 15)).toBe(15);
  });
});
