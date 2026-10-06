import { ConflictException } from '@nestjs/common';
import type { CreateSaleDto } from './dto/create-sale.dto';

/** A replayed sync_id must be the same sale: same branch, till, session, sequence and content. */
export function assertSameSaleContext(
  existing: {
    branch_id: string;
    terminal_id: string | null;
    offline_session_id: string | null;
    terminal_sequence: bigint | null;
    command_fingerprint: string | null;
  },
  dto: CreateSaleDto,
  terminalId: string,
  terminalSequence: bigint,
  commandFingerprint: string,
): void {
  if (
    existing.branch_id !== dto.branch_id ||
    existing.terminal_id !== terminalId ||
    existing.offline_session_id !== dto.offline_session_id ||
    existing.terminal_sequence !== terminalSequence ||
    existing.command_fingerprint !== commandFingerprint
  ) {
    throw new ConflictException({
      code: 'SALE_IDEMPOTENCY_CONTEXT_CONFLICT',
      message_ar: 'رقم المزامنة مستخدم لعملية مختلفة في الهوية أو الوردية أو الجهاز.',
      message: 'sync_id already belongs to a different accounting context',
    });
  }
}
