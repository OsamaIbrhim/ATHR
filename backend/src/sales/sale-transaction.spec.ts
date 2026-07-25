import { Prisma } from '@prisma/client';
import {
  getErrorMessage,
  getPrismaErrorCode,
  getSaleTransactionOptions,
  isExpiredSaleTransactionError,
} from './sale-transaction';

describe('sale transaction configuration and diagnostics', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('uses production-safe defaults', () => {
    delete process.env.SALE_TRANSACTION_MAX_WAIT_MS;
    delete process.env.SALE_TRANSACTION_TIMEOUT_MS;

    expect(getSaleTransactionOptions()).toEqual({
      maxWait: 10_000,
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });

  it('accepts explicit Railway overrides', () => {
    process.env.SALE_TRANSACTION_MAX_WAIT_MS = '15000';
    process.env.SALE_TRANSACTION_TIMEOUT_MS = '45000';

    expect(getSaleTransactionOptions()).toEqual({
      maxWait: 15_000,
      timeout: 45_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });

  it('falls back when an override is invalid', () => {
    process.env.SALE_TRANSACTION_MAX_WAIT_MS = '0';
    process.env.SALE_TRANSACTION_TIMEOUT_MS = 'not-a-number';

    expect(getSaleTransactionOptions()).toEqual({
      maxWait: 10_000,
      timeout: 30_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });

  it('classifies Prisma P2028 as an expired transaction', () => {
    const error = Object.assign(
      new Error('Transaction API error: Transaction not found'),
      { code: 'P2028' },
    );

    expect(getPrismaErrorCode(error)).toBe('P2028');
    expect(getErrorMessage(error)).toContain('Transaction not found');
    expect(isExpiredSaleTransactionError(error)).toBe(true);
  });

  it('does not classify unrelated Prisma failures as expiration', () => {
    const error = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });

    expect(isExpiredSaleTransactionError(error)).toBe(false);
  });
});
