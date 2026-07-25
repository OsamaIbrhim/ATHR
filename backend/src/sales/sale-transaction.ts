import { Prisma } from '@prisma/client';

const DEFAULT_SALE_TRANSACTION_MAX_WAIT_MS = 10_000;
const DEFAULT_SALE_TRANSACTION_TIMEOUT_MS = 30_000;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSaleTransactionOptions() {
  return {
    maxWait: positiveInteger(
      process.env.SALE_TRANSACTION_MAX_WAIT_MS,
      DEFAULT_SALE_TRANSACTION_MAX_WAIT_MS,
    ),
    timeout: positiveInteger(
      process.env.SALE_TRANSACTION_TIMEOUT_MS,
      DEFAULT_SALE_TRANSACTION_TIMEOUT_MS,
    ),
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  };
}

export function getPrismaErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }

  return null;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unknown sale transaction error';
}

export function isExpiredSaleTransactionError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();

  return (
    code === 'P2028' ||
    message.includes('transaction not found') ||
    message.includes('transaction api error')
  );
}
