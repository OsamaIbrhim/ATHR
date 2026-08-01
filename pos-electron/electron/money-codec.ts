import { Money } from '@athr/domain-core'

/**
 * ATHR POS currently operates in Egypt only (see the hardcoded "EGP"/"ج"
 * receipt currency in main.ts) — every local money column uses this
 * currency. A future multi-currency WP will thread a real CurrencyCode
 * through instead of this constant.
 */
const POS_CURRENCY = 'EGP'

/**
 * Local-storage codec: converts between the decimal-string amounts used at
 * the POS IPC/validation boundary and the integer minor-units
 * representation stored in the `*_minor_units` SQLite columns. Built on
 * `@athr/domain-core`'s `Money` so all rounding/precision rules live in one
 * place; this file only adapts that value object to SQLite's native
 * integer column type (domain-core stays free of any storage concern).
 */
export function decimalToMinorUnits(amount: number | string): number {
  const minorUnits = Money.of(String(amount), POS_CURRENCY).toMinorUnits()
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER) || minorUnits < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Money value exceeds the safe SQLite integer range')
  }
  return Number(minorUnits)
}

export function minorUnitsToDecimal(minorUnits: number): string {
  return Money.fromMinorUnits(BigInt(minorUnits), POS_CURRENCY).toWire().amount
}
