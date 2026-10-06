import { randomUUID } from 'crypto';

/** What a till prints on the receipt, e.g. `POS1-000123`. */
export const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const MAX_SUFFIX = 9;

/**
 * The numbers a sale may be stored under, in order of preference: the number
 * the till printed, then the same number with `-2` .. `-9`.
 */
export function invoiceNumberCandidates(printed: string): string[] {
  return [printed, ...Array.from({ length: MAX_SUFFIX - 1 }, (_, index) => `${printed}-${index + 2}`)];
}

/**
 * The number to store a POS sale under. It is the printed number verbatim unless
 * another invoice of the tenant already holds it (a till that was wiped and
 * re-enrolled restarts its numbering); then it is the first free suffixed
 * number. A sale is never refused over its number.
 */
export function pickInvoiceNumber(printed: string, taken: ReadonlySet<string>): string {
  const free = invoiceNumberCandidates(printed).find((candidate) => !taken.has(candidate));
  return free ?? `${printed}-${randomUUID().slice(0, 8)}`;
}
