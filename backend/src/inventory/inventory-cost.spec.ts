import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { planCostMovement } from './inventory-cost';

const D = (value: number | string) => new Prisma.Decimal(value);
const line = (extra: Record<string, unknown> = {}) => ({ variantId: 'variant-1', ...extra }) as any;

describe('planCostMovement (warehouse moving weighted average)', () => {
  it('averages an incoming receipt into the existing stock', () => {
    // 10 on hand at 90, 10 received for 1100 -> (10*90 + 1100) / 20 = 100
    const plan = planCostMovement('purchase_receipt', line({ unitCost: 110, value: 1100 }), D(10), D(10), D(90));

    expect(plan.costAfter.toFixed(4)).toBe('100.0000');
    expect(plan.quantityBefore.toString()).toBe('10');
    expect(plan.quantityAfter.toString()).toBe('20');
    expect(plan.movementValue.toFixed(2)).toBe('1100.00');
    expect(plan.valueBefore.toFixed(2)).toBe('900.00');
    expect(plan.valueAfter.toFixed(2)).toBe('2000.00');
    expect(plan.roundingAdjustment.toFixed(2)).toBe('0.00');
  });

  it('uses the exact line value and logs the difference the 4-decimal average cannot hold', () => {
    // 3 units for exactly 100.00 -> average 33.3333, the line value stays 100.00
    const exact = planCostMovement('purchase_receipt', line({ unitCost: '33.3333', value: 100 }), D(3), D(0), D(0));
    expect(exact.movementValue.toFixed(2)).toBe('100.00');
    expect(exact.costAfter.toFixed(4)).toBe('33.3333');
    expect(exact.valueAfter.toFixed(2)).toBe('100.00');
    expect(exact.roundingAdjustment.toFixed(2)).toBe('0.00');

    // 20000 units for 100.03 -> average 0.0050 (4 decimals); the stock is then
    // worth 100.00, and the 0.03 is recorded as rounding so the value equation holds.
    const tiny = planCostMovement('purchase_receipt', line({ unitCost: '0.0050', value: '100.03' }), D(20000), D(0), D(0));
    expect(tiny.movementValue.toFixed(2)).toBe('100.03');
    expect(tiny.costAfter.toFixed(4)).toBe('0.0050');
    expect(tiny.valueAfter.toFixed(2)).toBe('100.00');
    expect(tiny.roundingAdjustment.toFixed(2)).toBe('-0.03');
    expect(tiny.valueAfter.minus(tiny.valueBefore.plus(tiny.movementValue)).toFixed(2)).toBe(tiny.roundingAdjustment.toFixed(2));
  });

  it('adopts the incoming unit cost while the warehouse is in deficit', () => {
    // -2 on hand at 100, receive 5 for 400 -> 3 on hand at 80 (value/qty of the receipt)
    const plan = planCostMovement('purchase_receipt', line({ unitCost: 80, value: 400 }), D(5), D(-2), D(100));

    expect(plan.quantityAfter.toString()).toBe('3');
    expect(plan.costAfter.toFixed(4)).toBe('80.0000');
    expect(plan.valueBefore.toFixed(2)).toBe('0.00');
    expect(plan.valueAfter.toFixed(2)).toBe('240.00');
  });

  it('keeps the average when the receipt does not clear the deficit', () => {
    const plan = planCostMovement('purchase_receipt', line({ unitCost: 80, value: 160 }), D(2), D(-5), D(100));
    expect(plan.quantityAfter.toString()).toBe('-3');
    expect(plan.costAfter.toFixed(4)).toBe('100.0000');
  });

  it('returns goods to a customer at the cost they were sold at', () => {
    const plan = planCostMovement('customer_return', line({ unitCost: 80, value: 80 }), D(1), D(0), D(100));
    expect(plan.costAfter.toFixed(4)).toBe('80.0000');
  });

  it('removes a supplier return at the current average without moving it', () => {
    const plan = planCostMovement('supplier_return', line(), D(-2), D(10), D('90'));

    expect(plan.movementValue.toFixed(2)).toBe('-180.00');
    expect(plan.costAfter.toFixed(4)).toBe('90.0000');
    expect(plan.unitCost.toFixed(4)).toBe('90.0000');
    expect(plan.quantityAfter.toString()).toBe('8');
  });

  it('refuses a supplier return value that is not the current average cost', () => {
    expect(() =>
      planCostMovement('supplier_return', line({ value: -170 }), D(-2), D(10), D(90)),
    ).toThrow(BadRequestException);
  });

  it('values an adjustment gain at the current average, so the average does not move', () => {
    const plan = planCostMovement('adjustment', line(), D(4), D(6), D(90));

    expect(plan.movementValue.toFixed(2)).toBe('360.00');
    expect(plan.costAfter.toFixed(4)).toBe('90.0000');
    expect(plan.quantityAfter.toString()).toBe('10');
    expect(plan.valueAfter.toFixed(2)).toBe('900.00');
  });

  it('values an adjustment gain at an explicit cost when one is given', () => {
    const plan = planCostMovement('adjustment', line({ unitCost: 100 }), D(10), D(10), D(90));
    expect(plan.costAfter.toFixed(4)).toBe('95.0000');
  });

  it('removes an adjustment loss at the current average without moving it', () => {
    const plan = planCostMovement('adjustment', line(), D(-3), D(10), D(90));

    expect(plan.movementValue.toFixed(2)).toBe('-270.00');
    expect(plan.unitCost.toFixed(4)).toBe('90.0000');
    expect(plan.costAfter.toFixed(4)).toBe('90.0000');
    expect(plan.quantityAfter.toString()).toBe('7');
    expect(plan.roundingAdjustment.toFixed(2)).toBe('0.00');
  });

  it('keeps the average for an adjustment gain that does not clear a deficit', () => {
    const plan = planCostMovement('adjustment', line(), D(2), D(-5), D(90));
    expect(plan.quantityAfter.toString()).toBe('-3');
    expect(plan.costAfter.toFixed(4)).toBe('90.0000');
  });

  it('restores the earlier average when a receipt is reversed', () => {
    const plan = planCostMovement('purchase_reversal', line({ value: -900, restoreCost: 100 }), D(-10), D(10), D(90));

    expect(plan.costBefore.toFixed(4)).toBe('90.0000');
    expect(plan.costAfter.toFixed(4)).toBe('100.0000');
    expect(plan.movementValue.toFixed(2)).toBe('-900.00');
    expect(plan.quantityAfter.toString()).toBe('0');
    // value after (0) = value before (900) + movement (-900) + rounding (0)
    expect(plan.roundingAdjustment.toFixed(2)).toBe('0.00');
  });

  it('rejects malformed cost commands', () => {
    expect(() => planCostMovement('purchase_receipt', line(), D(1), D(0), D(0))).toThrow(BadRequestException);
    expect(() => planCostMovement('purchase_receipt', line({ unitCost: 1 }), D(-1), D(5), D(1))).toThrow(BadRequestException);
    expect(() => planCostMovement('purchase_reversal', line({ value: -1 }), D(-1), D(5), D(1))).toThrow(BadRequestException);
  });

  it('refuses values beyond the Decimal(14,2) range', () => {
    expect(() =>
      planCostMovement('purchase_receipt', line({ unitCost: 1, value: '1000000000000.00' }), D(1), D(0), D(0)),
    ).toThrow(BadRequestException);
  });
});
