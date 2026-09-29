/**
 * Quantities are exact decimals with at most three places (Decimal(14,3) on
 * the server); how many are allowed for one item comes from its unit's
 * `uom_precision` (0 = pieces, 3 = kg). JS floats are only the transport:
 * every check and every sum goes through integer thousandths.
 */
export const QUANTITY_SCALE = 3
export const MAX_QUANTITY = 99_999_999.999

const PLAIN_QUANTITY = /^(\d+)(?:\.(\d{1,3}))?$/

/** A quantity in integer thousandths; throws when it is not a plain decimal with at most 3 places. */
export function quantityToMilli(quantity: number): number {
  const match = PLAIN_QUANTITY.exec(String(quantity))
  if (!match) throw new TypeError('Quantity must be a plain decimal with at most 3 places')
  const result = Number(match[1]) * 1000 + Number((match[2] || '').padEnd(QUANTITY_SCALE, '0'))
  if (!Number.isSafeInteger(result)) throw new RangeError('Quantity exceeds the safe range')
  return result
}

export function milliToQuantity(milli: number): number {
  return milli / 1000
}

/** True for a positive quantity the unit allows: at most `precision` decimals and within the server limit. */
export function isValidQuantity(quantity: unknown, precision = QUANTITY_SCALE): quantity is number {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) return false
  if (quantity <= 0 || quantity > MAX_QUANTITY) return false
  try {
    return quantityToMilli(quantity) % 10 ** (QUANTITY_SCALE - precision) === 0
  } catch {
    return false
  }
}

/** The shortest exact text for a quantity ("2", "1.235"). */
export function formatQuantity(quantity: number): string {
  return String(milliToQuantity(Math.round(quantity * 1000)))
}

export function addQuantity(left: number, right: number): number {
  return milliToQuantity(quantityToMilli(left) + quantityToMilli(right))
}

export function subtractQuantity(left: number, right: number): number {
  return milliToQuantity(quantityToMilli(left) - quantityToMilli(right))
}

/** Sum of many quantities (a cart total), exact. */
export function sumQuantities(values: Iterable<number>): number {
  let milli = 0
  for (const value of values) milli += quantityToMilli(value)
  return milliToQuantity(milli)
}

/** Divides a thousandths amount by `divisor`, rounding half up to a multiple of the unit's step. */
export function roundMilli(milli: number, precision: number): number {
  const step = 10 ** (QUANTITY_SCALE - precision)
  return Math.floor((milli + step / 2) / step) * step
}
