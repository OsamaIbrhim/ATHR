/**
 * Scale (weighing machine) barcodes: an EAN-13 whose digits are
 * `prefix(2) + item code + value + check digit`. The value is either the
 * weight or the price of the weighed item. One pure parser, used by the
 * backend and the POS, so both read a scale label the same way.
 */
export interface ScaleBarcodeConfig {
  readonly enabled: boolean;
  /** Two-digit prefixes that mark a scale label, e.g. ['20', '21', ... '29']. */
  readonly prefixes: readonly string[];
  /** Digits of the item code (PLU) after the prefix. */
  readonly item_digits: number;
  /** What the embedded value means. */
  readonly value: 'weight' | 'price';
  /** Decimal places of the embedded value (weight 3 => 01250 is 1.250). */
  readonly decimals: number;
}

export const DEFAULT_SCALE_BARCODE_CONFIG: ScaleBarcodeConfig = {
  enabled: false,
  prefixes: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'],
  item_digits: 5,
  value: 'weight',
  decimals: 3,
};

export interface ScaleBarcodeReading {
  /** The registered product code: prefix + item code (what `scale_plu` barcodes store). */
  readonly plu: string;
  readonly kind: 'weight' | 'price';
  /** Weight in the item's unit, or the label price, as a decimal number. */
  readonly value: number;
}

const PREFIX_DIGITS = 2;

/** The check digit for the first 12 digits of an EAN-13. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** True when `code` is 13 digits with a correct EAN-13 check digit. */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * Reads a scale label. Returns null when scale barcodes are off, the code is
 * not a valid EAN-13, or the prefix is not one of the configured prefixes,
 * so the caller can fall back to an ordinary barcode lookup.
 */
export function parseScaleBarcode(
  code: string,
  config: ScaleBarcodeConfig,
): ScaleBarcodeReading | null {
  if (!config.enabled || !isValidEan13(code)) return null;
  if (!config.prefixes.includes(code.slice(0, PREFIX_DIGITS))) return null;
  const pluLength = PREFIX_DIGITS + config.item_digits;
  if (12 - pluLength <= 0) return null;
  const raw = Number(code.slice(pluLength, 12));
  return {
    plu: code.slice(0, pluLength),
    kind: config.value,
    value: Number((raw / 10 ** config.decimals).toFixed(config.decimals)),
  };
}
