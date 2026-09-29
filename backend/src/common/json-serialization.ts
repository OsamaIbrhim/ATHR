import { Prisma } from '@prisma/client';

/**
 * Quantity columns are Decimal(14,3), which Prisma hands to JSON as strings.
 * The POS and admin have always read quantities as JSON numbers (they used to
 * be integers), so quantity fields keep that wire shape. Money and cost
 * Decimals are deliberately not listed: they stay strings as before.
 */
const QUANTITY_FIELDS = new Set([
  'qty',
  'qty_on_hand',
  'qty_reserved',
  'shipped_qty',
  'received_qty',
  'damaged_qty',
  'missing_qty',
  'quantity_delta',
  'quantity_before',
  'quantity_after',
  'in_transit_after',
  'on_hand_delta',
  'reserved_delta',
  'on_hand_after',
  'reserved_after',
  'current_global_qty',
]);

/**
 * Express-scoped JSON fallback: BigInt database counters and cursors become
 * decimal strings (API services should still expose them explicitly; this
 * guard prevents an unexpected future BigInt field from turning a valid
 * request into an HTTP 500 without mutating the global BigInt prototype), and
 * Decimal quantity fields become numbers.
 */
export function apiJsonReplacer(this: unknown, key: string, value: unknown) {
  if (typeof value === 'bigint') return value.toString();
  if (
    QUANTITY_FIELDS.has(key) &&
    typeof value === 'string' &&
    // `value` is already the string from Decimal#toJSON; the holder still has the Decimal.
    Prisma.Decimal.isDecimal((this as Record<string, unknown> | null)?.[key])
  ) {
    return Number(value);
  }
  return value;
}
