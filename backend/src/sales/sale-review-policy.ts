import { createHash } from 'crypto';
import { CreateSaleDto } from './dto/create-sale.dto';

export const TICKET_REISSUE_REVIEW_CODES = new Set([
  'OFFLINE_ACCOUNTING_TICKET_INVALID',
]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function ticketKeyId(token: string) {
  const value = String(token || '').split('.')[0]?.trim();
  return value || null;
}

export function sanitizeSaleReviewCommand(command: CreateSaleDto) {
  const token = String(command.offline_accounting_token || '');
  const {
    offline_accounting_token: _discarded,
    ...safe
  } = command;
  return {
    ...safe,
    offline_accounting_token_hash: createHash('sha256')
      .update(token)
      .digest('hex'),
  };
}

export function saleReviewRejectionConfirmed(
  localInvoiceNumber: string,
  confirmationReference: unknown,
  financialSettlementConfirmed: unknown,
) {
  return (
    String(confirmationReference || '').trim() ===
      String(localInvoiceNumber || '').trim() &&
    financialSettlementConfirmed === true
  );
}

export function saleReviewFingerprint(
  command: CreateSaleDto,
  terminalId: string,
) {
  return createHash('sha256')
    .update(JSON.stringify(canonical({
      v: 1,
      terminal_id: terminalId,
      command: sanitizeSaleReviewCommand(command),
    })))
    .digest('hex');
}
