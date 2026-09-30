import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InventoryCostMovementType } from '@prisma/client';
import { MAX_MONEY } from '../common/money';
import type { StockLine } from './inventory.types';

const ROUND = Prisma.Decimal.ROUND_HALF_UP;
const ZERO = new Prisma.Decimal(0);

const round2 = (value: Prisma.Decimal) => value.toDecimalPlaces(2, ROUND);
const round4 = (value: Prisma.Decimal) => value.toDecimalPlaces(4, ROUND);

/** What one cost movement row records; derived only from the locked stock row and the line. */
export type CostPlan = {
  type: InventoryCostMovementType;
  quantityBefore: Prisma.Decimal;
  quantityAfter: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  costBefore: Prisma.Decimal;
  costAfter: Prisma.Decimal;
  valueBefore: Prisma.Decimal;
  movementValue: Prisma.Decimal;
  valueAfter: Prisma.Decimal;
  roundingAdjustment: Prisma.Decimal;
};

const INCOMING: InventoryCostMovementType[] = ['opening_balance', 'purchase_receipt', 'customer_return'];

/**
 * The moving weighted-average rule of one warehouse stock row.
 *
 *  - incoming (receipt, customer return, opening, transfer-in): the average
 *    becomes (on_hand * avg + value) / (on_hand + qty). While the warehouse is
 *    in deficit (on_hand < 0) the incoming unit cost simply becomes the
 *    average; if the result is still <= 0 the average is unchanged.
 *  - adjustment: signed. A gain is incoming at the line's unit cost, by default
 *    the current average (so the average does not move); a loss leaves at the
 *    current average like a supplier return. One command may mix both.
 *  - supplier_return: goods leave at the current average (value is derived and,
 *    if the caller supplied one, must match); the average does not change.
 *  - purchase_reversal: the average is restored to the value it had before the
 *    reversed receipt.
 */
export function planCostMovement(
  type: InventoryCostMovementType,
  line: Pick<StockLine, 'variantId' | 'unitCost' | 'value' | 'restoreCost'>,
  delta: Prisma.Decimal,
  qtyBefore: Prisma.Decimal,
  avgBefore: Prisma.Decimal,
): CostPlan {
  const qtyAfter = qtyBefore.plus(delta);
  let movementValue: Prisma.Decimal;
  let avgAfter = avgBefore;

  const adjustmentLoss = type === 'adjustment' && delta.isNegative();
  if (INCOMING.includes(type) || (type === 'adjustment' && !adjustmentLoss)) {
    const unitCost = line.unitCost ?? (type === 'adjustment' ? avgBefore : undefined);
    if (delta.lte(0) || unitCost === undefined) {
      throw new BadRequestException(`${type} needs a positive quantity and a unit cost`);
    }
    movementValue = round2(
      line.value === undefined ? new Prisma.Decimal(unitCost).mul(delta) : new Prisma.Decimal(line.value),
    );
    if (movementValue.isNegative()) throw new BadRequestException('Incoming cost value cannot be negative');
    if (qtyAfter.gt(0)) {
      avgAfter = round4(
        qtyBefore.lt(0)
          ? movementValue.div(delta)
          : qtyBefore.mul(avgBefore).plus(movementValue).div(qtyAfter),
      );
    }
  } else if (type === 'supplier_return' || adjustmentLoss) {
    if (delta.gte(0)) throw new BadRequestException(`${type} must remove stock`);
    movementValue = round2(delta.mul(avgBefore));
    if (line.value !== undefined && !new Prisma.Decimal(line.value).equals(movementValue)) {
      throw new BadRequestException(
        'Supplier return must remove inventory at the current moving-average cost',
      );
    }
  } else {
    // purchase_reversal
    if (delta.gte(0) || line.value === undefined || line.restoreCost === undefined) {
      throw new BadRequestException('purchase_reversal needs a negative quantity, a value and a restore cost');
    }
    movementValue = round2(new Prisma.Decimal(line.value));
    if (movementValue.gt(0)) throw new BadRequestException('purchase_reversal value cannot be positive');
    avgAfter = new Prisma.Decimal(line.restoreCost);
  }

  const valueBefore = round2(Prisma.Decimal.max(qtyBefore, ZERO).mul(avgBefore));
  const valueAfter = round2(Prisma.Decimal.max(qtyAfter, ZERO).mul(avgAfter));
  if (valueBefore.gt(MAX_MONEY) || valueAfter.gt(MAX_MONEY) || movementValue.abs().gt(MAX_MONEY)) {
    throw new BadRequestException(
      `Inventory value is outside the supported range for variant ${line.variantId}`,
    );
  }
  return {
    type,
    quantityBefore: qtyBefore,
    quantityAfter: qtyAfter,
    unitCost: delta.isZero() ? ZERO : round4(movementValue.abs().div(delta.abs())),
    costBefore: avgBefore,
    costAfter: avgAfter,
    valueBefore,
    movementValue,
    valueAfter,
    roundingAdjustment: valueAfter.minus(valueBefore.plus(movementValue)),
  };
}
