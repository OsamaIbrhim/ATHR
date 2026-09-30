import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import { domainError, UNPROCESSABLE } from '../common/domain-error';
import { pageOf } from '../common/pagination';
import { quantityNumber } from '../common/quantity';
import type { LowStockDto } from './dto/low-stock.dto';

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

type Row = {
  branch_id: string;
  variant_id: string;
  sku: string;
  label: string;
  name_ar: string | null;
  name_en: string | null;
  tracking: string;
  barcode: string | null;
  cost_price: Prisma.Decimal;
  qty_on_hand: Prisma.Decimal | null;
  last_sold_at: Date | null;
  total: bigint;
};

/**
 * The owner's "what do I need to restock or fix" lists, read from the default
 * (selling) warehouse of each branch:
 *   - at or below zero: items with a stock row whose balance is <= 0
 *     (`zero` and `negative`; negative means sold before stock was entered);
 *   - no stock row: active stocked items that never had a movement there,
 *     where a new shop lands before its opening balances.
 * Only stocked, active items appear; services and non-stock items never do.
 */
@Injectable()
export class LowStockService {
  constructor(private readonly prisma: PrismaService) {}

  async list(context: TenantContext, query: LowStockDto, actor: AuthenticatedUser) {
    const status = query.status ?? 'all';
    const branchId = resolveBranchScope(actor, query.branch_id);
    if (status === 'no_stock_row' && !branchId) {
      throw domainError(UNPROCESSABLE, 'BRANCH_REQUIRED', 'Choose a branch to list items without a stock record', 'اختر فرعًا لعرض الأصناف بلا رصيد مسجّل.');
    }
    const paging = { page: query.page, page_size: query.page_size };
    const search = query.q?.trim()
      ? Prisma.sql`AND (v."sku" ILIKE ${likePattern(query.q.trim())} OR p."name_en" ILIKE ${likePattern(query.q.trim())}
            OR p."name_ar" ILIKE ${likePattern(query.q.trim())}
            OR EXISTS (SELECT 1 FROM "ProductBarcode" b WHERE b."tenant_id" = v."tenant_id" AND b."variant_id" = v."id" AND b."code" = ${query.q.trim()}))`
      : Prisma.empty;
    const warehouses = Prisma.sql`
      wh AS (
        SELECT w."id", w."branch_id" FROM "Warehouse" w
        WHERE w."tenant_id" = ${context.tenantId}::uuid AND w."is_default" AND w."branch_id" IS NOT NULL
          ${branchId ? Prisma.sql`AND w."branch_id" = ${branchId}::uuid` : Prisma.empty}
      )`;

    const [rows, counts] = await Promise.all([
      status === 'no_stock_row' ? this.withoutRow(context.tenantId, warehouses, search, paging) : this.atOrBelowZero(context.tenantId, warehouses, search, status, paging),
      this.counts(context.tenantId, warehouses, search, branchId),
    ]);
    const branches = await this.prisma.branch.findMany({
      where: { tenant_id: context.tenantId, id: { in: [...new Set(rows.map((row) => row.branch_id))] } },
      select: { id: true, name_ar: true, name_en: true },
    });
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const withCost = actor.permissions.has('inventory.position.view-cost');
    const items = rows.map((row) => ({
      branch: branchById.get(row.branch_id) ?? { id: row.branch_id },
      variant: { id: row.variant_id, sku: row.sku, label: row.label, name_ar: row.name_ar, name_en: row.name_en, tracking: row.tracking, barcode: row.barcode },
      qty_on_hand: row.qty_on_hand === null ? null : quantityNumber(row.qty_on_hand),
      status: row.qty_on_hand === null ? 'no_stock_row' : row.qty_on_hand.isNegative() ? 'negative' : 'zero',
      last_sold_at: row.last_sold_at,
      ...(withCost ? { cost_price: row.cost_price.toFixed(4) } : {}),
    }));
    return { ...pageOf(items, Number(rows[0]?.total ?? 0), paging), counts };
  }

  private atOrBelowZero(tenantId: string, warehouses: Prisma.Sql, search: Prisma.Sql, status: string, paging: { page: number; page_size: number }) {
    const filter = status === 'zero' ? Prisma.sql`s."qty_on_hand" = 0` : status === 'negative' ? Prisma.sql`s."qty_on_hand" < 0` : Prisma.sql`s."qty_on_hand" <= 0`;
    return this.prisma.$queryRaw<Row[]>`
      WITH ${warehouses}
      SELECT wh."branch_id", v."id" AS "variant_id", v."sku", v."label", p."name_ar", p."name_en", v."tracking"::text AS "tracking",
             (SELECT MIN(b."code") FROM "ProductBarcode" b WHERE b."tenant_id" = v."tenant_id" AND b."variant_id" = v."id") AS "barcode",
             v."cost_price", s."qty_on_hand", s."last_sold_at", COUNT(*) OVER() AS "total"
      FROM wh
      JOIN "InventoryStock" s ON s."tenant_id" = ${tenantId}::uuid AND s."warehouse_id" = wh."id"
      JOIN "ProductVariant" v ON v."tenant_id" = s."tenant_id" AND v."id" = s."variant_id"
      JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
      WHERE v."is_active" AND p."is_active" AND v."item_type" = 'stocked' AND ${filter} ${search}
      ORDER BY s."qty_on_hand" ASC, s."last_sold_at" DESC NULLS LAST, v."sku"
      LIMIT ${paging.page_size} OFFSET ${(paging.page - 1) * paging.page_size}
    `;
  }

  private withoutRow(tenantId: string, warehouses: Prisma.Sql, search: Prisma.Sql, paging: { page: number; page_size: number }) {
    return this.prisma.$queryRaw<Row[]>`
      WITH ${warehouses}
      SELECT wh."branch_id", v."id" AS "variant_id", v."sku", v."label", p."name_ar", p."name_en", v."tracking"::text AS "tracking",
             (SELECT MIN(b."code") FROM "ProductBarcode" b WHERE b."tenant_id" = v."tenant_id" AND b."variant_id" = v."id") AS "barcode",
             v."cost_price", NULL::numeric AS "qty_on_hand", NULL::timestamp AS "last_sold_at", COUNT(*) OVER() AS "total"
      FROM wh
      CROSS JOIN "ProductVariant" v
      JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
      WHERE v."tenant_id" = ${tenantId}::uuid AND v."is_active" AND p."is_active" AND v."item_type" = 'stocked'
        AND NOT EXISTS (
          SELECT 1 FROM "InventoryStock" s
          WHERE s."tenant_id" = v."tenant_id" AND s."warehouse_id" = wh."id" AND s."variant_id" = v."id"
        )
        ${search}
      ORDER BY v."sku"
      LIMIT ${paging.page_size} OFFSET ${(paging.page - 1) * paging.page_size}
    `;
  }

  /** Tab counts. `no_stock_row` is only counted for a single branch (across all branches it is not meaningful). */
  private async counts(tenantId: string, warehouses: Prisma.Sql, search: Prisma.Sql, branchId: string | undefined) {
    const [row] = await this.prisma.$queryRaw<Array<{ zero: bigint; negative: bigint }>>`
      WITH ${warehouses}
      SELECT COUNT(*) FILTER (WHERE s."qty_on_hand" = 0) AS "zero", COUNT(*) FILTER (WHERE s."qty_on_hand" < 0) AS "negative"
      FROM wh
      JOIN "InventoryStock" s ON s."tenant_id" = ${tenantId}::uuid AND s."warehouse_id" = wh."id" AND s."qty_on_hand" <= 0
      JOIN "ProductVariant" v ON v."tenant_id" = s."tenant_id" AND v."id" = s."variant_id"
      JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
      WHERE v."is_active" AND p."is_active" AND v."item_type" = 'stocked' ${search}
    `;
    let noRow: number | null = null;
    if (branchId) {
      const [missing] = await this.prisma.$queryRaw<Array<{ items: bigint }>>`
        WITH ${warehouses}
        SELECT COUNT(*) AS "items"
        FROM wh
        CROSS JOIN "ProductVariant" v
        JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
        WHERE v."tenant_id" = ${tenantId}::uuid AND v."is_active" AND p."is_active" AND v."item_type" = 'stocked'
          AND NOT EXISTS (
            SELECT 1 FROM "InventoryStock" s
            WHERE s."tenant_id" = v."tenant_id" AND s."warehouse_id" = wh."id" AND s."variant_id" = v."id"
          )
          ${search}
      `;
      noRow = Number(missing?.items ?? 0);
    }
    const zero = Number(row?.zero ?? 0);
    const negative = Number(row?.negative ?? 0);
    return { all: zero + negative, zero, negative, no_stock_row: noRow };
  }
}
