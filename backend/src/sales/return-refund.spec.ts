import { Prisma } from '@prisma/client';
import { assertWithinReturnWindow, refundForLine } from './return-refund';

const D = (value: number | string) => new Prisma.Decimal(value);

// 3 units at 100, 10% discount on the line (30 off the net of 300), tax 14% of 270 = 37.80.
const line = { qty: D(3), unit_price: D(100), discount_amount: D(30), tax_amount: D('37.8') };

describe('refundForLine', () => {
  it('refunds the share of what was paid, not the list price', () => {
    const refund = refundForLine(line, D(0), D(1));
    expect([refund.net.toString(), refund.tax.toString()]).toEqual(['90', '12.6']);
  });

  it('adds up to exactly the line when it is returned in several goes', () => {
    const parts = [D(1), D(1), D(1)];
    let before = D(0);
    let net = D(0);
    let tax = D(0);
    for (const part of parts) {
      const refund = refundForLine(line, before, part);
      net = net.plus(refund.net);
      tax = tax.plus(refund.tax);
      before = before.plus(part);
    }
    expect([net.toString(), tax.toString()]).toEqual(['270', '37.8']);
  });

  it('refunds the whole line when everything is returned at once', () => {
    const refund = refundForLine(line, D(0), D(3));
    expect([refund.net.toString(), refund.tax.toString()]).toEqual(['270', '37.8']);
  });

  it('keeps a line without discount at unit price and unit tax', () => {
    const plain = { qty: D(2), unit_price: D(150), discount_amount: D(0), tax_amount: D(42) };
    const refund = refundForLine(plain, D(0), D(1));
    expect([refund.net.toString(), refund.tax.toString()]).toEqual(['150', '21']);
  });
});

describe('assertWithinReturnWindow', () => {
  const now = new Date('2026-10-20T00:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it('accepts a sale inside the tenant window and refuses one outside it', () => {
    expect(() => assertWithinReturnWindow(daysAgo(10), 14, now)).not.toThrow();
    expect(() => assertWithinReturnWindow(daysAgo(10), 7, now)).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'RETURN_WINDOW_EXPIRED' }) }));
  });

  it('refuses every return when the window is 0', () => {
    expect(() => assertWithinReturnWindow(daysAgo(0), 0, now)).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'RETURNS_NOT_ACCEPTED' }) }));
  });
});
