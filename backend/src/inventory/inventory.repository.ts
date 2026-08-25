import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantScope } from '../identity/tenant-context.type';

export type InventoryReconciliationRow = {
  branch_id: string;
  variant_id: string;
  stock_on_hand: number | null;
  stock_reserved: number | null;
  ledger_on_hand: bigint | number | null;
  ledger_reserved: bigint | number | null;
  last_movement_at: Date | null;
};

/** WP-007 Phase A §A.3.2 — tenant-scoped repository for the `inventory` module. */
@Injectable()
export class InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findStock(context: TenantScope, variantId: string, branchId?: string) {
    return this.prisma.inventoryStock.findMany({
      where: {
        tenant_id: context.tenantId,
        variant_id: variantId,
        qty_on_hand: { gt: 0 },
        ...(branchId ? { branch_id: branchId } : {}),
      },
      include: { branch: true },
    });
  }

  async listMovements(context: TenantScope, variantId: string, branchId?: string, take = 100) {
    return this.prisma.inventoryMovement.findMany({
      where: {
        tenant_id: context.tenantId,
        variant_id: variantId,
        ...(branchId ? { branch_id: branchId } : {}),
      },
      include: {
        branch: { select: { id: true, code: true, name_ar: true, name_en: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            product: { select: { name_ar: true, name_en: true } },
          },
        },
        creator: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ occurred_at: 'desc' }, { recorded_at: 'desc' }, { id: 'desc' }],
      take: Math.min(500, Math.max(1, take)),
    });
  }

  /**
   * Blueprint §120 "Raw SQL guarded". This reconciliation aggregates the
   * whole `InventoryMovement` ledger against `InventoryStock`; without a
   * tenant predicate on *both* sides of the FULL OUTER JOIN it would compare
   * one tenant's stock against every tenant's movements and report the
   * difference as a data-integrity mismatch. The predicate is bound as a
   * parameter, not interpolated.
   *
   * WP-009 Phase A PR2: the join key is `warehouse_id` (InventoryStock's
   * actual identity since the key swap), not `branch_id`. `branch_id` is
   * denormalized on both tables and, today, in a fixed 1:1 relationship with
   * warehouse_id -- but that is a fact about the data, not something the
   * schema enforces, and InventoryStock/InventoryMovement no longer carry a
   * branch_id-based identity to safely join on. Grouping the ledger CTE by
   * `(warehouse_id, branch_id, variant_id)` rather than `warehouse_id,
   * variant_id)` alone is deliberate: it keeps branch_id available to
   * project in the output without an aggregate, while still joining on
   * warehouse_id -- and if that 1:1 assumption is ever broken by a
   * centralized warehouse serving multiple branches, this GROUP BY starts
   * fanning into multiple ledger rows per warehouse instead of silently
   * picking one, which fails loud rather than mis-reporting.
   *
   * The output shape does not change: every row still projects `branch_id`,
   * not `warehouse_id` -- no client reads this response any differently.
   */
  async reconciliationMismatches(
    context: TenantScope,
    branchId?: string,
  ): Promise<InventoryReconciliationRow[]> {
    const branchScope = branchId
      ? Prisma.sql`AND COALESCE(stock."branch_id", ledger."branch_id") = ${branchId}::uuid`
      : Prisma.empty;
    return this.prisma.$queryRaw<InventoryReconciliationRow[]>(
      Prisma.sql`
        WITH ledger AS (
          SELECT
            movement."warehouse_id",
            movement."branch_id",
            movement."variant_id",
            SUM(movement."on_hand_delta") AS "ledger_on_hand",
            SUM(movement."reserved_delta") AS "ledger_reserved",
            MAX(movement."recorded_at") AS "last_movement_at"
          FROM "InventoryMovement" movement
          WHERE movement."tenant_id" = ${context.tenantId}::uuid
          GROUP BY movement."warehouse_id", movement."branch_id", movement."variant_id"
        )
        SELECT
          COALESCE(stock."branch_id", ledger."branch_id") AS "branch_id",
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
        WHERE (
          COALESCE(stock."qty_on_hand", 0) <> COALESCE(ledger."ledger_on_hand", 0)
          OR COALESCE(stock."qty_reserved", 0) <> COALESCE(ledger."ledger_reserved", 0)
        )
        ${branchScope}
        ORDER BY
          COALESCE(stock."branch_id", ledger."branch_id"),
          COALESCE(stock."variant_id", ledger."variant_id")
        LIMIT 1000
      `,
    );
  }
}
