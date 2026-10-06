import {
  divideScaledBigIntRoundHalfUp,
  formatScaledBigIntAsDecimal,
  parseDecimalToScaledBigInt,
} from './internal/decimal';

/**
 * The one implementation of a sale line's money arithmetic. The backend
 * (sale command, exchange, returns) and the POS both call it, so a till and the
 * server that receives its sale cannot disagree by a cent.
 *
 * Everything is exact BigInt arithmetic on minor units (money: 2 places,
 * quantity: 3, tax rate in percent: 4), rounded HALF_UP. Inputs and outputs are
 * plain decimal strings (numbers are accepted and converted).
 *
 * ## Conventions (binding, documented in docs/design/W3-api.md)
 *
 * - `unitPrice` is the tax-EXCLUSIVE unit price and `unitTax` the tax on one
 *   unit, both as quoted by the price book (net + tax = the shelf price when the
 *   price is tax-inclusive). They come from the catalog the till holds.
 * - A line with no discount keeps its quoted amounts exactly:
 *   net = unitPrice x qty, tax = unitTax x qty (so a sale without discounts is
 *   unchanged from before discounts existed).
 * - A discount reduces the price AS THE CASHIER SEES IT (the "authored" amount):
 *   the gross (net + tax) under a tax-inclusive price, the net under a
 *   tax-exclusive price. Tax is then recomputed on what is left
 *   ({@link calculateTax}), at line level.
 * - A percent discount is `authored x value / 100`. An amount discount is the
 *   amount off the whole line (capped at the line). An invoice discount is
 *   spread over the lines in proportion to what each has left after its own
 *   discount; the LAST line that still has a positive amount (in input order)
 *   takes the rounding difference.
 */

export type TaxMode = 'inclusive' | 'exclusive';
export type DiscountType = 'amount' | 'percent';
export interface DiscountSpec {
  readonly type: DiscountType;
  readonly value: string | number;
}
export type DecimalInput = string | number;

const MONEY_SCALE = 2;
const QTY_SCALE = 3;
const RATE_SCALE = 4;
const PERCENT_SCALE = 4;
const TEN = 10n;

function text(value: DecimalInput): string {
  return typeof value === 'number' ? value.toFixed(6) : value;
}

const minor = (value: DecimalInput): bigint => parseDecimalToScaledBigInt(text(value), MONEY_SCALE);
const milli = (value: DecimalInput): bigint => parseDecimalToScaledBigInt(text(value), QTY_SCALE);
const rate4 = (value: DecimalInput): bigint => parseDecimalToScaledBigInt(text(value), RATE_SCALE);
const pct4 = (value: DecimalInput): bigint => parseDecimalToScaledBigInt(text(value), PERCENT_SCALE);
const show = (value: bigint): string => formatScaledBigIntAsDecimal(value, MONEY_SCALE);
const div = divideScaledBigIntRoundHalfUp;
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export interface TaxCalculation {
  /** Tax-exclusive amount. */
  readonly net: string;
  readonly tax: string;
  /** net + tax. */
  readonly gross: string;
}

/**
 * The inclusive/exclusive split (BR-TAX-204). `authoredAmount` is the amount as
 * the price context stored it and `mode` says what it means:
 *
 *   exclusive: authored = net;   tax = net x rate
 *   inclusive: authored = gross; net = gross / (1 + rate), tax = gross - net
 *
 * The inclusive form rounds `net` once and subtracts, so net + tax equals the
 * authored gross exactly. `ratePercent` is a percentage with up to 4 decimals.
 */
export function calculateTax(ratePercent: DecimalInput, mode: TaxMode, authoredAmount: DecimalInput): TaxCalculation {
  const authored = minor(authoredAmount);
  const split = splitTax(authored, rate4(ratePercent), mode);
  return { net: show(split.net), tax: show(split.tax), gross: show(split.gross) };
}

function splitTax(authored: bigint, rate: bigint, mode: TaxMode) {
  const hundred = 100n * TEN ** BigInt(RATE_SCALE);
  if (mode === 'inclusive') {
    const net = div(authored * hundred, hundred + rate);
    return { net, tax: authored - net, gross: authored };
  }
  const tax = div(authored * rate, hundred);
  return { net: authored, tax, gross: authored + tax };
}

/** A line amount for a (possibly fractional) quantity: round(unit x qty). */
export function lineAmount(unit: DecimalInput, qty: DecimalInput): string {
  return show(div(minor(unit) * milli(qty), 1000n));
}

/** The money amount a discount takes off `base` (never more than `base`, never negative). */
export function discountAmount(spec: DiscountSpec | null | undefined, base: DecimalInput): string {
  return show(resolveDiscount(spec, minor(base)));
}

function resolveDiscount(spec: DiscountSpec | null | undefined, base: bigint): bigint {
  if (!spec || base <= 0n) return 0n;
  const raw =
    spec.type === 'percent'
      ? div(base * min(pct4(spec.value), 100n * TEN ** BigInt(PERCENT_SCALE)), 100n * TEN ** BigInt(PERCENT_SCALE))
      : minor(spec.value);
  if (raw <= 0n) return 0n;
  return min(raw, base);
}

/**
 * Splits `amount` over `weights` in proportion to them. Every part but the last
 * (the last with a positive weight) is rounded; that one takes what is left.
 */
export function allocateProportionally(amount: bigint, weights: readonly bigint[]): bigint[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  const parts = weights.map(() => 0n);
  if (amount <= 0n || total <= 0n) return parts;
  let last = -1;
  weights.forEach((weight, index) => {
    if (weight > 0n) last = index;
  });
  let assigned = 0n;
  weights.forEach((weight, index) => {
    if (index === last || weight <= 0n) return;
    parts[index] = div(amount * weight, total);
    assigned += parts[index];
  });
  parts[last] = amount - assigned;
  return parts;
}

export interface SaleLineInput {
  readonly qty: DecimalInput;
  /** Tax-exclusive unit price. */
  readonly unitPrice: DecimalInput;
  /** Tax on one unit at that price. */
  readonly unitTax: DecimalInput;
  /** Percentage, up to 4 decimals (14 = 14%). */
  readonly taxRate: DecimalInput;
  readonly taxMode: TaxMode;
  readonly discount?: DiscountSpec | null;
}

export interface SaleLineResult {
  /** Quoted net of the line before any discount. */
  readonly netBeforeDiscount: string;
  readonly taxBeforeDiscount: string;
  /** What the cashier saw before any discount (gross if inclusive, net if exclusive). */
  readonly authoredBeforeDiscount: string;
  /** The line's own discount plus its share of the invoice discount, as the cashier sees it. */
  readonly discountAuthored: string;
  /** The same discount as a reduction of the tax-exclusive amount. */
  readonly discountNet: string;
  readonly net: string;
  readonly tax: string;
  readonly gross: string;
}

export interface SaleTotals {
  /** Sum of the lines' quoted net, before discounts. */
  readonly subtotal: string;
  /** Sum of the tax-exclusive discounts. */
  readonly discountTotal: string;
  readonly taxTotal: string;
  /** subtotal - discountTotal + taxTotal. */
  readonly total: string;
}

export interface PricedSale {
  readonly lines: SaleLineResult[];
  readonly totals: SaleTotals;
}

/** Prices a whole sale: line discounts, the invoice discount, tax after discount, totals. */
export function priceSale(lines: readonly SaleLineInput[], invoiceDiscount?: DiscountSpec | null): PricedSale {
  const base = lines.map((line) => {
    const net0 = div(minor(line.unitPrice) * milli(line.qty), 1000n);
    const tax0 = div(minor(line.unitTax) * milli(line.qty), 1000n);
    const authored0 = line.taxMode === 'inclusive' ? net0 + tax0 : net0;
    const lineDiscount = resolveDiscount(line.discount, authored0);
    return { net0, tax0, authored0, lineDiscount, afterLine: authored0 - lineDiscount };
  });
  const remaining = base.reduce((sum, line) => sum + line.afterLine, 0n);
  const invoiceTotal = resolveDiscount(invoiceDiscount, remaining);
  const shares = allocateProportionally(
    invoiceTotal,
    base.map((line) => line.afterLine),
  );

  const results = lines.map((line, index): SaleLineResult => {
    const row = base[index]!;
    const discountAuthored = row.lineDiscount + shares[index]!;
    let net = row.net0;
    let tax = row.tax0;
    if (discountAuthored > 0n) {
      const split = splitTax(row.authored0 - discountAuthored, rate4(line.taxRate), line.taxMode);
      net = split.net;
      tax = split.tax;
    }
    return {
      netBeforeDiscount: show(row.net0),
      taxBeforeDiscount: show(row.tax0),
      authoredBeforeDiscount: show(row.authored0),
      discountAuthored: show(discountAuthored),
      discountNet: show(row.net0 - net),
      net: show(net),
      tax: show(tax),
      gross: show(net + tax),
    };
  });

  const sum = (pick: (line: SaleLineResult) => string) =>
    results.reduce((total, line) => total + minor(pick(line)), 0n);
  const subtotal = sum((line) => line.netBeforeDiscount);
  const discountTotal = sum((line) => line.discountNet);
  const taxTotal = sum((line) => line.tax);
  return {
    lines: results,
    totals: {
      subtotal: show(subtotal),
      discountTotal: show(discountTotal),
      taxTotal: show(taxTotal),
      total: show(subtotal - discountTotal + taxTotal),
    },
  };
}

/**
 * True when some line's combined discount (its own plus its invoice share) is
 * more than `maxPercent` of what the cashier saw for it. Exact (cross-multiplied),
 * so a discount of exactly the limit is not above it.
 */
export function isDiscountAboveLimit(lines: readonly SaleLineResult[], maxPercent: DecimalInput): boolean {
  const limit = pct4(maxPercent);
  const scale = 100n * TEN ** BigInt(PERCENT_SCALE);
  return lines.some((line) => {
    const authored = minor(line.authoredBeforeDiscount);
    return authored > 0n && minor(line.discountAuthored) * scale > limit * authored;
  });
}

/**
 * What returning units of a line refunds. The line's total (after discount) is
 * spread over its quantity by rounding the running share, so the parts of a
 * line that is returned in several goes add up to exactly the line's amount.
 */
export function cumulativeShare(
  lineTotal: DecimalInput,
  lineQty: DecimalInput,
  returnedBefore: DecimalInput,
  returning: DecimalInput,
): string {
  const total = minor(lineTotal);
  const qty = milli(lineQty);
  if (qty <= 0n) return show(0n);
  const upTo = (returned: bigint) => (returned >= qty ? total : div(total * returned, qty));
  const before = milli(returnedBefore);
  return show(upTo(before + milli(returning)) - upTo(before));
}
