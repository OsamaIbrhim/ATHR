import { Prisma } from '@prisma/client';

export const warehouseId = '99999999-0000-4000-8000-000000000001';

/**
 * InventoryService double: the stock engine is proven against Postgres by
 * `scripts/verify-inventory-engine.cjs`; these specs pin what sales asks of it.
 * `apply` reports the quantity after the command per line.
 */
export function inventoryDouble(qtyAfter = 8, reserved = 0, avgCost = 100) {
  return {
    defaultWarehouseId: jest.fn().mockResolvedValue(warehouseId),
    drawnLots: jest.fn().mockResolvedValue([]),
    serialStates: jest.fn().mockResolvedValue([]),
    apply: jest.fn().mockImplementation((_tx: unknown, command: any) =>
      Promise.resolve(
        command.lines.map((line: any) => ({
          variantId: line.variantId,
          qtyBefore: new Prisma.Decimal(qtyAfter).minus(line.qtyDelta),
          qtyAfter: new Prisma.Decimal(qtyAfter),
          reserved: new Prisma.Decimal(reserved),
          avgCostBefore: new Prisma.Decimal(avgCost),
          avgCost: new Prisma.Decimal(avgCost),
        })),
      ),
    ),
  };
}

