import { formatScaledBigIntAsDecimal, parseDecimalToScaledBigInt } from './internal/decimal';
import { type OpaqueId, parseOpaqueId } from './ids';

/**
 * Provisional fixed precision for all Quantity values. The real
 * Unit-of-Measure aggregate (and its per-unit precision/conversion policy)
 * is WP-008's job — this WP only needs a reference `UnitOfMeasureId` and a
 * scale-validated decimal value, not real UOM semantics.
 */
export const QUANTITY_DEFAULT_SCALE = 3;

export type UnitOfMeasureId = OpaqueId<'UnitOfMeasure'>;
export function parseUnitOfMeasureId(value: string): UnitOfMeasureId {
  return parseOpaqueId(value, 'UnitOfMeasure');
}

export interface QuantityWire {
  readonly value: string;
  readonly unit_id: string;
  readonly unit_code: string;
}

export class Quantity {
  private constructor(
    private readonly scaledValue: bigint,
    private readonly unitId: UnitOfMeasureId,
    private readonly unitCode: string,
  ) {}

  static of(value: string, unitId: UnitOfMeasureId, unitCode: string): Quantity {
    const normalizedUnitCode = unitCode.trim();
    if (normalizedUnitCode.length === 0) {
      throw new TypeError('Quantity requires a non-empty unit code.');
    }
    return new Quantity(
      parseDecimalToScaledBigInt(value, QUANTITY_DEFAULT_SCALE),
      unitId,
      normalizedUnitCode,
    );
  }

  static fromWire(wire: QuantityWire): Quantity {
    return Quantity.of(wire.value, parseUnitOfMeasureId(wire.unit_id), wire.unit_code);
  }

  toWire(): QuantityWire {
    return {
      value: formatScaledBigIntAsDecimal(this.scaledValue, QUANTITY_DEFAULT_SCALE),
      unit_id: this.unitId,
      unit_code: this.unitCode,
    };
  }

  getUnitId(): UnitOfMeasureId {
    return this.unitId;
  }

  getUnitCode(): string {
    return this.unitCode;
  }

  isNegative(): boolean {
    return this.scaledValue < 0n;
  }

  isZero(): boolean {
    return this.scaledValue === 0n;
  }

  equals(other: Quantity): boolean {
    return (
      this.scaledValue === other.scaledValue &&
      this.unitId === other.unitId &&
      this.unitCode === other.unitCode
    );
  }
}
