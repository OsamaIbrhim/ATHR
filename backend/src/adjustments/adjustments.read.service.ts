import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { hasBranchAccess, resolveBranchScope } from '../auth/branch-access';
import { pageArgs, pageOf } from '../common/pagination';
import { quantityNumber } from '../common/quantity';
import type { ListAdjustmentsDto } from './dto/adjustment.dto';

const ZERO = new Prisma.Decimal(0);
const canSeeCost = (actor: AuthenticatedUser) => actor.permissions.has('inventory.position.view-cost');

@Injectable()
export class AdjustmentsReadService {
  constructor(private readonly prisma: PrismaService) {}

  async list(context: TenantContext, query: ListAdjustmentsDto, actor: AuthenticatedUser) {
    const branchId = resolveBranchScope(actor, query.branch_id);
    const base: Prisma.StockAdjustmentWhereInput = {
      tenant_id: context.tenantId,
      ...(branchId ? { branch_id: branchId } : {}),
      ...(query.q?.trim() ? { adjustment_number: { contains: query.q.trim(), mode: 'insensitive' } } : {}),
    };
    const where = { ...base, ...(query.status ? { status: query.status } : {}) };
    const paging = { page: query.page, page_size: query.page_size };
    const [rows, total, counts] = await Promise.all([
      this.prisma.stockAdjustment.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        ...pageArgs(paging),
      }),
      this.prisma.stockAdjustment.count({ where }),
      this.prisma.stockAdjustment.groupBy({ by: ['status'], where: base, _count: true }),
    ]);

    const ids = rows.map((row) => row.id);
    const [totals, branches, names] = await Promise.all([
      this.lineTotals(context.tenantId, ids),
      this.prisma.branch.findMany({
        where: { tenant_id: context.tenantId, id: { in: [...new Set(rows.map((row) => row.branch_id))] } },
        select: { id: true, name_ar: true, name_en: true },
      }),
      this.userNames(rows.flatMap((row) => [row.created_by])),
    ]);
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const withCost = canSeeCost(actor);
    const items = rows.map((row) => ({
      id: row.id,
      adjustment_number: row.adjustment_number,
      status: row.status,
      branch: branchById.get(row.branch_id) ?? null,
      note: row.note,
      created_at: row.created_at,
      created_by: row.created_by ? { id: row.created_by, name: names.get(row.created_by) ?? null } : null,
      line_count: totals.get(row.id)?.lines ?? 0,
      ...(withCost ? { net_value: (totals.get(row.id)?.value ?? ZERO).toFixed(2) } : {}),
    }));
    const statusCounts = { all: 0, draft: 0, approved: 0, posted: 0, cancelled: 0 } as Record<string, number>;
    for (const group of counts) {
      statusCounts[group.status] = group._count;
      statusCounts.all += group._count;
    }
    return { ...pageOf(items, total, paging), status_counts: statusCounts };
  }

  async get(context: TenantContext, id: string, actor: AuthenticatedUser) {
    const header = await this.prisma.stockAdjustment.findFirst({ where: { id, tenant_id: context.tenantId } });
    // A document of another branch reads as missing, like one of another tenant.
    if (!header || !hasBranchAccess(actor, header.branch_id)) throw new NotFoundException('Stock adjustment not found');

    const items = await this.prisma.stockAdjustmentItem.findMany({
      where: { tenant_id: context.tenantId, adjustment_id: id },
      orderBy: { id: 'asc' },
    });
    const variantIds = items.map((item) => item.variant_id);
    const [variants, stock, branch, names] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: { tenant_id: context.tenantId, id: { in: variantIds } },
        select: { id: true, sku: true, label: true, cost_price: true, product_id: true },
      }),
      this.prisma.inventoryStock.findMany({
        where: { tenant_id: context.tenantId, warehouse_id: header.warehouse_id, variant_id: { in: variantIds } },
        select: { variant_id: true, qty_on_hand: true, avg_cost: true },
      }),
      this.prisma.branch.findFirst({ where: { id: header.branch_id, tenant_id: context.tenantId }, select: { id: true, name_ar: true, name_en: true } }),
      this.userNames([header.created_by, header.approved_by, header.posted_by, header.cancelled_by]),
    ]);
    const products = await this.prisma.product.findMany({
      where: { tenant_id: context.tenantId, id: { in: [...new Set(variants.map((variant) => variant.product_id))] } },
      select: { id: true, name_ar: true, name_en: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    const stockById = new Map(stock.map((row) => [row.variant_id, row]));

    const withCost = canSeeCost(actor);
    let increase = ZERO;
    let decrease = ZERO;
    let increaseValue = ZERO;
    let decreaseValue = ZERO;
    const lines = items.map((item) => {
      const variant = variantById.get(item.variant_id);
      const product = variant ? productById.get(variant.product_id) : undefined;
      const current = stockById.get(item.variant_id);
      // Posted lines carry what they were valued at; earlier ones are estimated at today's average.
      const unitCost = item.unit_cost ?? current?.avg_cost ?? variant?.cost_price ?? ZERO;
      const value = item.value ?? item.qty_delta.mul(unitCost).toDecimalPlaces(2);
      if (item.qty_delta.isPositive()) {
        increase = increase.plus(item.qty_delta);
        increaseValue = increaseValue.plus(value);
      } else {
        decrease = decrease.plus(item.qty_delta.abs());
        decreaseValue = decreaseValue.plus(value);
      }
      return {
        id: item.id,
        variant: {
          id: item.variant_id,
          sku: variant?.sku ?? null,
          label: variant?.label ?? '',
          name_ar: product?.name_ar ?? null,
          name_en: product?.name_en ?? null,
        },
        qty_delta: quantityNumber(item.qty_delta),
        reason_code: item.reason_code,
        note: item.note,
        qty_on_hand: quantityNumber(current?.qty_on_hand ?? 0),
        qty_before: item.qty_before === null ? null : quantityNumber(item.qty_before),
        qty_after: item.qty_after === null ? null : quantityNumber(item.qty_after),
        ...(withCost ? { unit_cost: unitCost.toFixed(4), value: value.toFixed(2) } : {}),
      };
    });
    const who = (userId: string | null, at: Date | null) =>
      userId || at ? { id: userId, name: userId ? (names.get(userId) ?? null) : null, at } : null;

    return {
      id: header.id,
      adjustment_number: header.adjustment_number,
      status: header.status,
      branch,
      warehouse_id: header.warehouse_id,
      note: header.note,
      created: who(header.created_by, header.created_at),
      approved: who(header.approved_by, header.approved_at),
      posted: who(header.posted_by, header.posted_at),
      cancelled: who(header.cancelled_by, header.cancelled_at),
      cancellation_reason: header.cancellation_reason,
      items: lines,
      totals: {
        line_count: lines.length,
        increase_qty: quantityNumber(increase),
        decrease_qty: quantityNumber(decrease),
        ...(withCost
          ? {
              increase_value: increaseValue.toFixed(2),
              decrease_value: decreaseValue.toFixed(2),
              net_value: increaseValue.plus(decreaseValue).toFixed(2),
            }
          : {}),
      },
    };
  }

  /** Line count and value per document (value = stamped at posting, else today's average cost). */
  private async lineTotals(tenantId: string, ids: string[]) {
    if (!ids.length) return new Map<string, { lines: number; value: Prisma.Decimal }>();
    const rows = await this.prisma.$queryRaw<Array<{ adjustment_id: string; lines: bigint; value: Prisma.Decimal }>>`
      SELECT item."adjustment_id", COUNT(*) AS "lines",
             COALESCE(SUM(COALESCE(item."value", ROUND(item."qty_delta" * COALESCE(stock."avg_cost", variant."cost_price"), 2))), 0) AS "value"
      FROM "StockAdjustmentItem" item
      JOIN "StockAdjustment" doc ON doc."tenant_id" = item."tenant_id" AND doc."id" = item."adjustment_id"
      JOIN "ProductVariant" variant ON variant."tenant_id" = item."tenant_id" AND variant."id" = item."variant_id"
      LEFT JOIN "InventoryStock" stock
        ON stock."tenant_id" = item."tenant_id" AND stock."warehouse_id" = doc."warehouse_id" AND stock."variant_id" = item."variant_id"
      WHERE item."tenant_id" = ${tenantId}::uuid AND item."adjustment_id" = ANY(${ids}::uuid[])
      GROUP BY item."adjustment_id"
    `;
    return new Map(rows.map((row) => [row.adjustment_id, { lines: Number(row.lines), value: row.value }]));
  }

  /** Display names of the people who acted on a document (users are global; only those ids are read). */
  private async userNames(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}
