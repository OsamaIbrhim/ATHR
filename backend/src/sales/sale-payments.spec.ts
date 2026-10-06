import { Prisma } from '@prisma/client';
import { paymentsFingerprint, planPayments } from './sale-payments';

const total = new Prisma.Decimal(114);
const all = ['cash', 'card', 'wallet', 'credit'] as const;

describe('planPayments', () => {
  it('numbers the rows in the order they were sent and sums cash and credit', () => {
    const plan = planPayments(
      [
        { method: 'cash', amount: 50, tendered: 100 },
        { method: 'card', amount: 14, reference: ' ****1234 ' },
        { method: 'credit', amount: 50 },
      ],
      total,
      all,
    );
    expect(plan.rows.map((row) => [row.sequence, row.method])).toEqual([[1, 'cash'], [2, 'card'], [3, 'credit']]);
    expect(plan.rows[0].tendered?.toString()).toBe('100');
    expect(plan.rows[1].reference).toBe('****1234');
    expect(plan.cash.toString()).toBe('50');
    expect(plan.credit.toString()).toBe('50');
    expect(plan.warnings).toEqual([]);
  });

  it('flags payments that do not add up to the total, and still returns every row', () => {
    const plan = planPayments([{ method: 'cash', amount: 100 }], total, all);
    expect(plan.warnings).toEqual(['PAYMENT_TOTAL_MISMATCH']);
    expect(plan.rows).toHaveLength(1);
  });

  it('flags a method the tenant switched off, and still records it', () => {
    const plan = planPayments([{ method: 'bank_transfer', amount: 114 }], total, all);
    expect(plan.warnings).toEqual(['PAYMENT_METHOD_DISABLED']);
    expect(plan.rows[0].method).toBe('bank_transfer');
  });

  it('treats a zero total with a zero payment as consistent', () => {
    expect(planPayments([{ method: 'cash', amount: 0 }], new Prisma.Decimal(0), all).warnings).toEqual([]);
  });
});

describe('paymentsFingerprint', () => {
  it('is canonical in money and keeps the order of the tenders', () => {
    const a = paymentsFingerprint([{ method: 'cash', amount: 1 }, { method: 'card', amount: 2.5 }]);
    expect(a).toEqual([
      { method: 'cash', amount: '1.00', tendered: null, reference: null },
      { method: 'card', amount: '2.50', tendered: null, reference: null },
    ]);
    expect(paymentsFingerprint([{ method: 'card', amount: 2.5 }, { method: 'cash', amount: 1 }])).not.toEqual(a);
  });
});
