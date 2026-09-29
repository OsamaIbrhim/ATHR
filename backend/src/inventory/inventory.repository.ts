import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantScope } from '../identity/tenant-context.type';

export type InventoryReconciliationRow = {
  warehouse_id: string;
  branch_id: string | null;
  variant_id: string;
  stock_on_hand: Prisma.Decimal | null;
  stock_reserved: Prisma.Decimal | null;
  ledger_on_hand: Prisma.Decimal | null;
  ledger_reserved: Prisma.Decimal | null;
  last_movement_at: Date | null;
};

/**
 * Stock columns a reader may see. `avg_cost` is a cost: it stays out of the
 * position lookup, which only needs `inventory.position.view`.
 */
export const STOCK_QUANTITY_COLUMNS = {
  warehouse_id: true,
  variant_id: true,
  tenant_id: true,
  qty_on_hand: true,
  qty_reserved: true,
  last_sold_at: true,
} as const;

/** Stock is keyed by warehouse; admin/POS consumers still read the owning branch off each row. */
function withBranch<T extends { warehouse: { branch_id: string | null; branch: unknown } }>(row: T) {
  return { ...row, branch_id: row.warehouse.branch_id, branch: row.warehouse.branch };
}

/** WP-007 Phase A §A.3.2 — tenant-scoped repository for the `inventory` module (reads only). */
@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findStock(context: TenantScope, variantId: string, branchId?: string) {
    const rows = await this.prisma.inventoryStock.findMany({
      where: {
        tenant_id: context.tenantId,
        variant_id: variantId,
        qty_on_hand: { gt: 0 },
        ...(branchId ? { warehouse: { branch_id: branchId } } : {}),
      },
      select: { ...STOCK_QUANTITY_COLUMNS, warehouse: { include: { branch: true } } },
    });
    return rows.map(withBranch);
  }

  async listMovements(context: TenantScope, variantId: string, branchId?: string, take = 100) {
    const rows = await this.prisma.inventoryMovement.findMany({
      where: {
        tenant_id: context.tenantId,
        variant_id: variantId,
        ...(branchId ? { warehouse: { branch_id: branchId } } : {}),
      },
      include: {
        warehouse: {
          include: { branch: { select: { id: true, code: true, name_ar: true, name_en: true } } },
        },
        variant: {
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            product: { select: { name_ar: true, name_en: true } },
          },
        },
        creator: { select: { id: true, name: true } },
      },
      orderBy: [{ occurred_at: 'desc' }, { recorded_at: 'desc' }, { id: 'desc' }],
      take: Math.min(500, Math.max(1, take)),
    });
    return rows.map(withBranch);
  }

  /** The warehouse sales, returns, receipts and the POS sync use for a branch. */
  findDefaultWarehouseId(
    db: Pick<Prisma.TransactionClient, 'warehouse'>,
    tenantId: string,
    branchId: string,
  ) {
    return db.warehouse
      .findFirst({
        where: { tenant_id: tenantId, branch_id: branchId, is_default: true },
        select: { id: true },
      })
      .then((warehouse) => warehouse?.id ?? null);
  }

  /**
   * Compares every stock row with the sum of its ledger (not part of any hot
   * path). Blueprint §120 "Raw SQL guarded": the tenant predicate is bound on
   * both sides of the join so one tenant's stock is never compared with
   * another tenant's movements.
   */
  async reconciliationMismatches(
    context: TenantScope,
    branchId?: string,
  ): Promise<InventoryReconciliationRow[]> {
    const branchScope = branchId ? Prisma.sql`AND w."branch_id" = ${branchId}::uuid` : Prisma.empty;
    return this.prisma.$queryRaw<InventoryReconciliationRow[]>(
      Prisma.sql`
        WITH ledger AS (
          SELECT
            movement."warehouse_id",
            movement."variant_id",
            SUM(movement."on_hand_delta") AS "ledger_on_hand",
            SUM(movement."reserved_delta") AS "ledger_reserved",
            MAX(movement."recorded_at") AS "last_movement_at"
          FROM "InventoryMovement" movement
          WHERE movement."tenant_id" = ${context.tenantId}::uuid
          GROUP BY movement."warehouse_id", movement."variant_id"
        )
        SELECT
          COALESCE(stock."warehouse_id", ledger."warehouse_id") AS "warehouse_id",
          w."branch_id",
          COALESCE(stock."variant_id", ledger."variant_id") AS "variant_id",
          stock."qty_on_hand" AS "stock_on_hand",
          stock."qty_reserved" AS "stock_reserved",
          ledger."ledger_on_hand",
          ledger."ledger_reserved",
          ledger."last_movement_at"
        FROM (
          SELECT * FROM "InventoryStock"
          WHERE "tenant_id" = ${context.tenantId}::uuid
        ) stock
        FULL OUTER JOIN ledger
          ON ledger."warehouse_id" = stock."warehouse_id"
         AND ledger."variant_id" = stock."variant_id"
        JOIN "Warehouse" w
          ON w."id" = COALESCE(stock."warehouse_id", ledger."warehouse_id")
        WHERE (
          COALESCE(stock."qty_on_hand", 0) <> COALESCE(ledger."ledger_on_hand", 0)
          OR COALESCE(stock."qty_reserved", 0) <> COALESCE(ledger."ledger_reserved", 0)
        )
        ${branchScope}
        ORDER BY 1, 3
        LIMIT 1000
      `,
    );
  }
}
