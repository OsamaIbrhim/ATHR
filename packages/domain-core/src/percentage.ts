import { formatScaledBigIntAsDecimal, parseDecimalToScaledBigInt } from './internal/decimal';

/**
 * Internal precision (decimal places) retained for the canonical `rate`.
 * `display_percent` is derived on demand at `PERCENTAGE_RATE_SCALE - 2`
 * decimal places (a rate scaled by 10^-2 expressed as a percentage), per
 * API Contract v1.0 §28: `rate` is the single source of truth and
 * `display_percent` is never independently settable.
 */
export const PERCENTAGE_RATE_SCALE = 6;

export interface PercentageWire {
  readonly rate: string;
  readonly display_percent: string;
}

export class Percentage {
  private constructor(private readonly scaledRate: bigint) {}

  static fromRate(rate: string): Percentage {
    return new Percentage(parseDecimalToScaledBigInt(rate, PERCENTAGE_RATE_SCALE));
  }

  static fromWire(wire: PercentageWire): Percentage {
    return Percentage.fromRate(wire.rate);
  }

  toWire(): PercentageWire {
    return {
      rate: formatScaledBigIntAsDecimal(this.scaledRate, PERCENTAGE_RATE_SCALE),
      display_percent: formatScaledBigIntAsDecimal(this.scaledRate, PERCENTAGE_RATE_SCALE - 2),
    };
  }

  /** Internal accessor for `Money.multiplyByRate` — not part of the wire contract. */
  toRateScaledBigInt(): bigint {
    return this.scaledRate;
  }

  isNegative(): boolean {
    return this.scaledRate < 0n;
  }

  isZero(): boolean {
    return this.scaledRate === 0n;
  }

  equals(other: Percentage): boolean {
    return this.scaledRate === other.scaledRate;
  }
}
