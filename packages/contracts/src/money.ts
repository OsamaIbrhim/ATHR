/**
 * Wire-format types for decimal-string data — API Contract v1.0 §26–§28.
 *
 * These are pure shapes only: money/quantity/percentage never travel as JSON
 * numbers (floats). Arithmetic, rounding and scale enforcement are WP-004
 * (`@athr/domain-core`) behavior — this package only fixes the shape they
 * serialize to/from on the wire.
 */

export interface MoneyWire {
  readonly amount: string;
  readonly currency: string;
}

export interface QuantityWire {
  readonly value: string;
  readonly unit_id: string;
  readonly unit_code: string;
}

export interface PercentageWire {
  readonly rate: string;
  readonly display_percent: string;
}
