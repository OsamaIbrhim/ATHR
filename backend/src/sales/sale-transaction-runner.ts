import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { PosTerminal, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateSaleDto } from './dto/create-sale.dto';
import {
  getErrorMessage,
  getPrismaErrorCode,
  getSaleTransactionOptions,
  isExpiredSaleTransactionError,
} from './sale-transaction';

/** Runs a sale inside one database transaction; an expired or failed one is logged and surfaced as retryable. */
export async function runSaleTransaction<T>(
  prisma: PrismaService,
  logger: Logger,
  dto: CreateSaleDto,
  terminal: Pick<PosTerminal, 'id'>,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const options = getSaleTransactionOptions();
  const startedAt = Date.now();

  try {
    return await prisma.$transaction(operation, options);
  } catch (error: unknown) {
    const prismaCode = getPrismaErrorCode(error);
    const expired = isExpiredSaleTransactionError(error);

    if (expired || prismaCode) {
      logger.error(
        JSON.stringify({
          level: 'error',
          errorCode: expired
            ? 'SALE_TRANSACTION_EXPIRED'
            : 'SALE_DATABASE_OPERATION_FAILED',
          component: 'database',
          status: 'rolled_back',
          operation: 'create_sale',
          syncId: dto.sync_id,
          branchId: dto.branch_id,
          terminalId: terminal.id,
          terminalSequence: dto.terminal_sequence,
          itemCount: dto.items.length,
          prismaCode,
          elapsedMs: Date.now() - startedAt,
          maxWaitMs: options.maxWait,
          timeoutMs: options.timeout,
          message: expired
            ? 'The sale transaction expired before completion and was rolled back.'
            : 'The sale transaction failed during a database operation and was rolled back.',
          originalMessage: getErrorMessage(error),
        }),
        error instanceof Error ? error.stack : undefined,
      );
    }

    if (expired) {
      throw new ServiceUnavailableException({
        code: 'SALE_TRANSACTION_EXPIRED',
        retryable: true,
        retry_after_ms: 2_000,
        message_ar:
          'تعذر إتمام عملية البيع داخل مهلة قاعدة البيانات. أعد المحاولة بنفس رقم المزامنة.',
        message:
          'The sale transaction exceeded the database timeout and was rolled back. Retry using the same sync_id.',
      });
    }

    throw error;
  }
}
