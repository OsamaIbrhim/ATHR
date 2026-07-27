import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createHash } from 'crypto';
import {
  CreateSaleDto,
  CreateSaleItemDto,
} from './dto/create-sale.dto';

export const TICKET_REISSUE_REVIEW_CODES = new Set([
  'OFFLINE_ACCOUNTING_TICKET_INVALID',
]);

export type StoredSaleReviewItem = {
  variant_id: string;
  qty: number;
  unit_price?: number;
  unit_tax?: number;
  price_version?: string;
  price_token?: string;
};

export type StoredSaleReviewCommand = {
  sync_id: string;
  branch_id: string;
  shift_id: string;
  origin_cashier_id: string;
  seller_id: string;
  offline_session_id: string;
  terminal_sequence: string;
  occurred_at: string;
  customer_phone?: string;
  items: StoredSaleReviewItem[];
  payment_method: string;
  language?: string;
  local_total?: number;
  offline_accounting_token_hash: string;
};

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

function storedItem(item: CreateSaleItemDto): StoredSaleReviewItem {
  return {
    variant_id: item.variant_id,
    qty: item.qty,
    ...(item.unit_price !== undefined
      ? { unit_price: item.unit_price }
      : {}),
    ...(item.unit_tax !== undefined
      ? { unit_tax: item.unit_tax }
      : {}),
    ...(item.price_version !== undefined
      ? { price_version: item.price_version }
      : {}),
    ...(item.price_token !== undefined
      ? { price_token: item.price_token }
      : {}),
  };
}

function storedCommand(
  command: CreateSaleDto,
  tokenHash: string,
): StoredSaleReviewCommand {
  return {
    sync_id: command.sync_id,
    branch_id: command.branch_id,
    shift_id: command.shift_id,
    origin_cashier_id: command.origin_cashier_id,
    seller_id: command.seller_id,
    offline_session_id: command.offline_session_id,
    terminal_sequence: command.terminal_sequence,
    occurred_at: command.occurred_at,
    ...(command.customer_phone !== undefined
      ? { customer_phone: command.customer_phone }
      : {}),
    items: command.items.map(storedItem),
    payment_method: command.payment_method,
    ...(command.language !== undefined
      ? { language: command.language }
      : {}),
    ...(command.local_total !== undefined
      ? { local_total: command.local_total }
      : {}),
    offline_accounting_token_hash: tokenHash,
  };
}

function itemJson(item: StoredSaleReviewItem): Prisma.InputJsonObject {
  return {
    variant_id: item.variant_id,
    qty: item.qty,
    ...(item.unit_price !== undefined
      ? { unit_price: item.unit_price }
      : {}),
    ...(item.unit_tax !== undefined
      ? { unit_tax: item.unit_tax }
      : {}),
    ...(item.price_version !== undefined
      ? { price_version: item.price_version }
      : {}),
    ...(item.price_token !== undefined
      ? { price_token: item.price_token }
      : {}),
  };
}

export function saleReviewCommandJson(
  command: StoredSaleReviewCommand,
): Prisma.InputJsonObject {
  return {
    sync_id: command.sync_id,
    branch_id: command.branch_id,
    shift_id: command.shift_id,
    origin_cashier_id: command.origin_cashier_id,
    seller_id: command.seller_id,
    offline_session_id: command.offline_session_id,
    terminal_sequence: command.terminal_sequence,
    occurred_at: command.occurred_at,
    ...(command.customer_phone !== undefined
      ? { customer_phone: command.customer_phone }
      : {}),
    items: command.items.map(itemJson),
    payment_method: command.payment_method,
    ...(command.language !== undefined
      ? { language: command.language }
      : {}),
    ...(command.local_total !== undefined
      ? { local_total: command.local_total }
      : {}),
    offline_accounting_token_hash:
      command.offline_accounting_token_hash,
  };
}

export function ticketKeyId(token: string) {
  const value = String(token || '').split('.')[0]?.trim();
  return value || null;
}

export function sanitizeSaleReviewCommand(
  command: CreateSaleDto,
): StoredSaleReviewCommand {
  const token = String(command.offline_accounting_token || '');
  return storedCommand(
    command,
    createHash('sha256').update(token).digest('hex'),
  );
}

export function parseStoredSaleReviewCommand(
  value: unknown,
): StoredSaleReviewCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored sale review command is not a JSON object');
  }

  const {
    offline_accounting_token_hash: tokenHashValue,
    ...commandValue
  } = value as Record<string, unknown>;
  const tokenHash = String(tokenHashValue || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
    throw new Error(
      'Stored sale review command has an invalid token hash',
    );
  }

  const candidate = plainToInstance(CreateSaleDto, {
    ...commandValue,
    // The original token is deliberately not persisted. This validation-only
    // placeholder lets the existing DTO validate every other immutable field.
    offline_accounting_token: 'sale-review-validation-token',
  });
  const errors = validateSync(candidate, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) {
    throw new Error(
      `Stored sale review command failed validation: ${errors
        .map((error) => error.property)
        .join(', ')}`,
    );
  }

  return storedCommand(candidate, tokenHash);
}

export function materializeSaleReviewCommand(
  command: StoredSaleReviewCommand,
  offlineAccountingToken: string,
): CreateSaleDto {
  if (
    !offlineAccountingToken ||
    offlineAccountingToken.length > 4096
  ) {
    throw new Error('Reissued offline accounting token is invalid');
  }

  return {
    sync_id: command.sync_id,
    branch_id: command.branch_id,
    shift_id: command.shift_id,
    origin_cashier_id: command.origin_cashier_id,
    seller_id: command.seller_id,
    offline_session_id: command.offline_session_id,
    terminal_sequence: command.terminal_sequence,
    occurred_at: command.occurred_at,
    offline_accounting_token: offlineAccountingToken,
    ...(command.customer_phone !== undefined
      ? { customer_phone: command.customer_phone }
      : {}),
    items: command.items.map((item) => ({ ...item })),
    payment_method: command.payment_method,
    ...(command.language !== undefined
      ? { language: command.language }
      : {}),
    ...(command.local_total !== undefined
      ? { local_total: command.local_total }
      : {}),
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
