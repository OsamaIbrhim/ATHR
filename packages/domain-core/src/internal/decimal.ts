/**
 * Decimal-safe helpers shared by Money, Quantity and Percentage.
 *
 * All arithmetic here operates on BigInt-scaled integers, never on native
 * JS `number`, so classic floating-point traps (e.g. `0.1 + 0.2`) cannot
 * occur. Rounding is HALF_UP (round half away from zero) throughout this
 * package — see `MONEY_ROUNDING_MODE` in `money.ts` for the rationale.
 */

const DECIMAL_STRING_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

export function parseDecimalToScaledBigInt(decimal: string, scale: number): bigint {
  const trimmed = decimal.trim();
  const match = DECIMAL_STRING_PATTERN.exec(trimmed);
  if (!match) {
    throw new TypeError(`Expected a plain decimal string, got: ${decimal}`);
  }

  const [, signPart = '', wholePart = '0', fractionPart = ''] = match;
  const sign = signPart === '-' ? -1n : 1n;
  const padded = (fractionPart + '0'.repeat(scale + 1)).slice(0, scale + 1);
  const kept = padded.slice(0, scale);
  const roundingDigit = Number(padded[scale]);
  const scaled = BigInt(wholePart) * 10n ** BigInt(scale) + (kept.length ? BigInt(kept) : 0n);

  return sign * (roundingDigit >= 5 ? scaled + 1n : scaled);
}

export function formatScaledBigIntAsDecimal(scaled: bigint, scale: number): string {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const sign = negative ? '-' : '';

  if (scale === 0) {
    return `${sign}${absolute.toString()}`;
  }

  const divisor = 10n ** BigInt(scale);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, '0');
  return `${sign}${whole.toString()}.${fraction}`;
}

export function divideScaledBigIntRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError('Cannot divide by zero.');
  }

  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const roundedUp = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;

  return negative ? -roundedUp : roundedUp;
}
