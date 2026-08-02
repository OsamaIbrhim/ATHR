import {
  divideScaledBigIntRoundHalfUp,
  formatScaledBigIntAsDecimal,
  parseDecimalToScaledBigInt,
} from './internal/decimal';
import { PERCENTAGE_RATE_SCALE, type Percentage } from './percentage';

/**
 * Rounding policy: HALF_UP (round half away from zero).
 *
 * Chosen — rather than banker's rounding — to match the POS local money
 * codec already shipped in `pos-electron/electron/money.ts` (`toCents`),
 * which cashiers already reconcile cash drawers against. Introducing a
 * different rounding policy in `domain-core` would create silent
 * discrepancies between the new value objects and existing POS totals.
 */
export const MONEY_ROUNDING_MODE = 'HALF_UP' as const;

export const SUPPORTED_CURRENCY_CODES = ['EGP', 'USD', 'SAR'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCY_CODES)[number];

interface CurrencyPolicy {
  readonly code: CurrencyCode;
  readonly minorUnitScale: number;
}

/**
 * Add a new currency by adding an entry here with its minor-unit scale
 * (number of decimal places), then adding the code to
 * `SUPPORTED_CURRENCY_CODES` above. No other change is required.
 */
const CURRENCY_POLICIES: Record<CurrencyCode, CurrencyPolicy> = {
  EGP: { code: 'EGP', minorUnitScale: 2 },
  USD: { code: 'USD', minorUnitScale: 2 },
  SAR: { code: 'SAR', minorUnitScale: 2 },
};

function currencyPolicy(code: string): CurrencyPolicy {
  const policy = (CURRENCY_POLICIES as Record<string, CurrencyPolicy | undefined>)[code];
  if (!policy) {
    throw new RangeError(
      `Unsupported currency code: ${code}. Add it to CURRENCY_POLICIES in money.ts.`,
    );
  }
  return policy;
}

export interface MoneyWire {
  readonly amount: string;
  readonly currency: string;
}

export class Money {
  private constructor(
    private readonly minorUnits: bigint,
    private readonly currency: CurrencyCode,
  ) {}

  static of(amount: string, currency: string): Money {
    const policy = currencyPolicy(currency);
    return new Money(parseDecimalToScaledBigInt(amount, policy.minorUnitScale), policy.code);
  }

  static fromMinorUnits(minorUnits: bigint, currency: string): Money {
    const policy = currencyPolicy(currency);
    return new Money(minorUnits, policy.code);
  }

  static fromWire(wire: MoneyWire): Money {
    return Money.of(wire.amount, wire.currency);
  }

  toWire(): MoneyWire {
    return {
      amount: formatScaledBigIntAsDecimal(
        this.minorUnits,
        currencyPolicy(this.currency).minorUnitScale,
      ),
      currency: this.currency,
    };
  }

  toMinorUnits(): bigint {
    return this.minorUnits;
  }

  getCurrency(): CurrencyCode {
    return this.currency;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new RangeError(
        `Cannot combine Money in ${this.currency} with Money in ${other.currency}.`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  multiplyByRate(rate: Percentage): Money {
    const numerator = this.minorUnits * rate.toRateScaledBigInt();
    const denominator = 10n ** BigInt(PERCENTAGE_RATE_SCALE);
    return new Money(divideScaledBigIntRoundHalfUp(numerator, denominator), this.currency);
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }
}
