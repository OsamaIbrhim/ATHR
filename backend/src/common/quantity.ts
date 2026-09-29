import { applyDecorators, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsNumber, Max, Min } from 'class-validator';

/**
 * Quantities are Decimal(14,3) everywhere (stock, ledgers, document lines).
 * What a caller may actually sell/receive is narrower: the base unit of
 * measure of the variant decides how many decimals make sense (piece = 0,
 * kg = 3). This file is the single place that knows both rules.
 */
export const QUANTITY_SCALE = 3;
export const MAX_QUANTITY = 99_999_999.999;

export type QuantityInput = Prisma.Decimal | number | string;

/** Parses a quantity and enforces the storage scale (at most 3 decimals). */
export function quantity(value: QuantityInput): Prisma.Decimal {
  const result = new Prisma.Decimal(value);
  if (!result.isFinite() || result.decimalPlaces() > QUANTITY_SCALE) {
    throw new TypeError(`Quantity must be finite with at most ${QUANTITY_SCALE} decimals`);
  }
  return result;
}

/** The decimals a variant's base unit allows; 0 when the variant has no unit. */
export function variantQuantityPrecision(variant: {
  base_uom?: { precision: number } | null;
}): number {
  return variant.base_uom?.precision ?? 0;
}

/**
 * Throws 422 when `value` has more decimals than the unit allows
 * (e.g. 1.250 is fine for kg, rejected for pieces).
 */
export function assertQuantityPrecision(
  value: QuantityInput,
  precision: number,
  subject: string,
): void {
  const decimals = new Prisma.Decimal(value).decimalPlaces();
  if (decimals > precision) {
    throw new UnprocessableEntityException({
      code: 'QUANTITY_PRECISION_EXCEEDED',
      message: `${subject}: quantity allows at most ${precision} decimal place(s)`,
      message_ar: 'الكمية تحتوي على كسور أكثر مما تسمح به وحدة القياس.',
      allowed_precision: precision,
    });
  }
}

/** JSON boundary: quantities are exposed as numbers (POS/admin contract). */
export function quantityNumber(value: QuantityInput): number {
  return Number(new Prisma.Decimal(value).toFixed(QUANTITY_SCALE));
}

/** DTO field: a positive quantity with at most 3 decimals. */
export function IsQuantity() {
  return applyDecorators(
    IsNumber({ maxDecimalPlaces: QUANTITY_SCALE, allowNaN: false, allowInfinity: false }),
    Min(0.001),
    Max(MAX_QUANTITY),
  );
}

/** DTO field: zero or a positive quantity with at most 3 decimals (e.g. damaged_qty). */
export function IsNonNegativeQuantity() {
  return applyDecorators(
    IsNumber({ maxDecimalPlaces: QUANTITY_SCALE, allowNaN: false, allowInfinity: false }),
    Min(0),
    Max(MAX_QUANTITY),
  );
}
