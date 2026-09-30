import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess, hasBranchAccess, resolveBranchScope } from '../auth/branch-access';
import { domainError, NOT_FOUND } from '../common/domain-error';
import { pageArgs, pageOf } from '../common/pagination';
import { quantityNumber } from '../common/quantity';
import { countScopeItems, scopePredicate, type CountScope } from './stock-count-scope';
import type { ListCountsDto, RecentEntriesDto, ReviewCountDto, ScopeSizeDto } from './dto/stock-count.dto';

const ZERO = new Prisma.Decimal(0);
const canSeeCost = (actor: AuthenticatedUser) => actor.permissions.has('inventory.position.view-cost');
const money = (value: Prisma.Decimal | null | undefined) => (value ?? ZERO).toFixed(2);
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

type ReviewRow = {
  variant_id: string;
  sku: string;
  label: string;
  name_ar: string | null;
  name_en: string | null;
  kind: 'counted' | 'uncounted';
  expected: Prisma.Decimal | null;
  counted: Prisma.Decimal | null;
  variance: Prisma.Decimal | null;
  on_hand: Prisma.Decimal;
  unit_cost: Prisma.Decimal;
  zeroed: boolean;
  applied_delta: Prisma.Decimal | null;
  total: bigint;
};

/** Reads of counts: list, detail, the review of variances, a counter's recent entries, scope size. */
@Injectable()
export class StockCountsReadService {
  constructor(private readonly prisma: PrismaService) {}

  async list(context: TenantContext, query: ListCountsDto, actor: AuthenticatedUser) {
    const branchId = resolveBranchScope(actor, query.branch_id);
    const base: Prisma.StockCountWhereInput = { tenant_id: context.tenantId, ...(branchId ? { branch_id: branchId } : {}) };
    const where = { ...base, ...(query.status ? { status: query.status } : {}) };
    const paging = { page: query.page, page_size: query.page_size };
    const [rows, total, statusGroups] = await Promise.all([
      this.prisma.stockCount.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], ...pageArgs(paging) }),
      this.prisma.stockCount.count({ where }),
      this.prisma.stockCount.groupBy({ by: ['status'], where: base, _count: true }),
    ]);
    const ids = rows.map((row) => row.id);
    const [counted, activity, sizes, branches] = await Promise.all([
      this.prisma.stockCountLine.groupBy({ by: ['count_id'], where: { tenant_id: context.tenantId, count_id: { in: ids }, zeroed: false }, _count: true }),
      this.prisma.stockCountEntry.groupBy({ by: ['count_id'], where: { tenant_id: context.tenantId, count_id: { in: ids } }, _max: { created_at: true } }),
      this.scopeSizes(context.tenantId, ids),
      this.prisma.branch.findMany({
        where: { tenant_id: context.tenantId, id: { in: [...new Set(rows.map((row) => row.branch_id))] } },
        select: { id: true, name_ar: true, name_en: true },
      }),
    ]);
    const countedBy = new Map(counted.map((group) => [group.count_id, group._count]));
    const activityBy = new Map(activity.map((group) => [group.count_id, group._max.created_at]));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const scopeNames = await this.scopeNames(context.tenantId, rows);
    const items = rows.map((row) => ({
      id: row.id,
      count_number: row.count_number,
      name: row.name,
      status: row.status,
      branch: branchById.get(row.branch_id) ?? null,
      scope: { type: row.scope_type, id: row.category_id ?? row.product_type_id, name: scopeNames.get(row.id) ?? null },
      counted_items: countedBy.get(row.id) ?? 0,
      items_in_scope: sizes.get(row.id) ?? 0,
      created_at: row.created_at,
      last_activity_at: activityBy.get(row.id) ?? row.updated_at,
    }));
    const status_counts: Record<string, number> = { all: 0, open: 0, posted: 0, cancelled: 0 };
    let all = 0;
    for (const group of statusGroups) {
      status_counts[group.status] = group._count;
      all += group._count;
    }
    status_counts.all = all;
    return { ...pageOf(items, total, paging), status_counts };
  }

  async get(context: TenantContext, id: string, actor: AuthenticatedUser) {
    const header = await this.header(context, id, actor);
    const [stats, entryStats, itemsInScope, branch, names, scopeNames] = await Promise.all([
      this.prisma.stockCountLine.aggregate({
        where: { tenant_id: context.tenantId, count_id: id, zeroed: false },
        _count: true,
        _sum: { counted_qty: true },
      }),
      this.entryStats(context.tenantId, id),
      countScopeItems(this.prisma, context.tenantId, header),
      this.prisma.branch.findFirst({ where: { id: header.branch_id, tenant_id: context.tenantId }, select: { id: true, name_ar: true, name_en: true } }),
      this.userNames([header.started_by, header.posted_by, header.cancelled_by]),
      this.scopeNames(context.tenantId, [header]),
    ]);
    const who = (userId: string | null, at: Date | null) => (userId || at ? { id: userId, name: userId ? (names.get(userId) ?? null) : null, at } : null);
    return {
      id: header.id,
      count_number: header.count_number,
      name: header.name,
      status: header.status,
      branch,
      warehouse_id: header.warehouse_id,
      scope: { type: header.scope_type, id: header.category_id ?? header.product_type_id, name: scopeNames.get(header.id) ?? null },
      started: who(header.started_by, header.created_at),
      posted: who(header.posted_by, header.posted_at),
      cancelled: who(header.cancelled_by, header.cancelled_at),
      uncounted_choice: header.uncounted_choice,
      counted_items: stats._count,
      counted_units: quantityNumber(stats._sum.counted_qty ?? ZERO),
      items_in_scope: itemsInScope,
      active_counters: entryStats.active_counters,
      unknown_scans: entryStats.unknown_scans,
    };
  }

  /**
   * The variances of a count. `expected_at_count` is the balance when the item was
   * first counted; `movement_after_count` is what sold or arrived since, so the
   * reviewer sees why the balance is not `expected`. Posting applies `variance`.
   */
  async review(context: TenantContext, id: string, query: ReviewCountDto, actor: AuthenticatedUser) {
    const header = await this.header(context, id, actor);
    const withCost = canSeeCost(actor);
    const paging = { page: query.page, page_size: query.page_size };
    const rows = this.rowsCte(context.tenantId, header);
    const search = query.q?.trim()
      ? Prisma.sql`AND (r."sku" ILIKE ${likePattern(query.q.trim())} OR r."name_en" ILIKE ${likePattern(query.q.trim())}
            OR r."name_ar" ILIKE ${likePattern(query.q.trim())}
            OR EXISTS (SELECT 1 FROM "ProductBarcode" b WHERE b."tenant_id" = ${context.tenantId}::uuid AND b."variant_id" = r."variant_id" AND b."code" = ${query.q.trim()}))`
      : Prisma.empty;
    const pageRows = await this.prisma.$queryRaw<ReviewRow[]>`
      ${rows}
      SELECT r.*, COUNT(*) OVER() AS "total"
      FROM "rows" r
      WHERE ${this.filterSql(query.filter ?? 'all')} ${search}
      ORDER BY ABS(COALESCE(r."variance", 0) * r."unit_cost") DESC, ABS(COALESCE(r."variance", 0)) DESC, r."sku"
      LIMIT ${paging.page_size} OFFSET ${(paging.page - 1) * paging.page_size}
    `;
    const [summary] = await this.prisma.$queryRaw<Array<Record<string, Prisma.Decimal | bigint | null>>>`
      ${rows}
      SELECT
        COUNT(*) FILTER (WHERE "kind" = 'counted' AND NOT "zeroed") AS "counted_items",
        COUNT(*) FILTER (WHERE "kind" = 'counted' AND "variance" <> 0) AS "items_with_variance",
        COUNT(*) FILTER (WHERE "kind" = 'uncounted') AS "uncounted_items",
        COALESCE(SUM("variance") FILTER (WHERE "variance" > 0), 0) AS "increase_qty",
        COALESCE(-SUM("variance") FILTER (WHERE "variance" < 0), 0) AS "decrease_qty",
        COALESCE(SUM(ROUND("variance" * "unit_cost", 2)) FILTER (WHERE "variance" > 0), 0) AS "increase_value",
        COALESCE(SUM(ROUND("variance" * "unit_cost", 2)) FILTER (WHERE "variance" < 0), 0) AS "decrease_value",
        COALESCE(SUM(ROUND("on_hand" * "unit_cost", 2)) FILTER (WHERE "kind" = 'uncounted'), 0) AS "uncounted_value"
      FROM "rows"
    `;
    const posted = header.status === 'posted';
    const items = pageRows.map((row) => {
      const variance = row.variance;
      const movement = !posted && row.expected ? row.on_hand.minus(row.expected) : null;
      return {
        variant: { id: row.variant_id, sku: row.sku, label: row.label, name_ar: row.name_ar, name_en: row.name_en },
        status: row.kind,
        zeroed: row.zeroed,
        expected_at_count: row.expected === null ? null : quantityNumber(row.expected),
        counted: row.counted === null ? null : quantityNumber(row.counted),
        variance: variance === null ? null : quantityNumber(variance),
        current_on_hand: quantityNumber(row.on_hand),
        movement_after_count: movement === null ? null : quantityNumber(movement),
        would_go_negative: !posted && variance !== null && variance.isNegative() && row.on_hand.plus(variance).isNegative(),
        applied_delta: row.applied_delta === null ? null : quantityNumber(row.applied_delta),
        ...(withCost
          ? { unit_cost: row.unit_cost.toFixed(4), variance_value: variance === null ? null : money(variance.mul(row.unit_cost).toDecimalPlaces(2)) }
          : {}),
      };
    });
    const dec = (key: string) => (summary?.[key] as Prisma.Decimal | undefined) ?? ZERO;
    const num = (key: string) => Number(summary?.[key] ?? 0);
    const unknown = await this.prisma.$queryRaw<Array<{ barcode: string; scans: bigint; units: Prisma.Decimal; last_at: Date }>>`
      SELECT "barcode", COUNT(*) AS "scans", SUM("qty_delta") AS "units", MAX("created_at") AS "last_at"
      FROM "StockCountEntry"
      WHERE "tenant_id" = ${context.tenantId}::uuid AND "count_id" = ${id}::uuid AND "variant_id" IS NULL AND "barcode" IS NOT NULL
      GROUP BY "barcode" ORDER BY MAX("created_at") DESC LIMIT 100
    `;
    return {
      count: { id: header.id, count_number: header.count_number, name: header.name, status: header.status, uncounted_choice: header.uncounted_choice },
      summary: {
        counted_items: num('counted_items'),
        items_with_variance: num('items_with_variance'),
        uncounted_items: num('uncounted_items'),
        increase_qty: quantityNumber(dec('increase_qty')),
        decrease_qty: quantityNumber(dec('decrease_qty')),
        ...(withCost
          ? {
              increase_value: money(dec('increase_value')),
              decrease_value: money(dec('decrease_value')),
              net_value: money(dec('increase_value').plus(dec('decrease_value'))),
              uncounted_value: money(dec('uncounted_value')),
            }
          : {}),
      },
      unknown_barcodes: unknown.map((row) => ({ barcode: row.barcode, scans: Number(row.scans), units: quantityNumber(row.units), last_scanned_at: row.last_at })),
      ...pageOf(items, Number(pageRows[0]?.total ?? 0), paging),
    };
  }

  /** What the calling counter has counted, newest first (the "recently counted" list of the counter view). */
  async recent(context: TenantContext, id: string, query: RecentEntriesDto, actor: AuthenticatedUser) {
    await this.header(context, id, actor);
    const paging = { page: query.page, page_size: query.page_size };
    const search = query.q?.trim()
      ? Prisma.sql`AND (v."sku" ILIKE ${likePattern(query.q.trim())} OR p."name_en" ILIKE ${likePattern(query.q.trim())} OR p."name_ar" ILIKE ${likePattern(query.q.trim())})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{ variant_id: string; sku: string; label: string; name_ar: string | null; name_en: string | null; mine: Prisma.Decimal; total: Prisma.Decimal; last_at: Date; all_rows: bigint }>
    >`
      SELECT e."variant_id", v."sku", v."label", p."name_ar", p."name_en",
             SUM(e."qty_delta") AS "mine", l."counted_qty" AS "total", MAX(e."created_at") AS "last_at",
             COUNT(*) OVER() AS "all_rows"
      FROM "StockCountEntry" e
      JOIN "StockCountLine" l ON l."tenant_id" = e."tenant_id" AND l."count_id" = e."count_id" AND l."variant_id" = e."variant_id"
      JOIN "ProductVariant" v ON v."tenant_id" = e."tenant_id" AND v."id" = e."variant_id"
      JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
      WHERE e."tenant_id" = ${context.tenantId}::uuid AND e."count_id" = ${id}::uuid AND e."counted_by" = ${actor.sub}::uuid
        ${search}
      GROUP BY e."variant_id", v."sku", v."label", p."name_ar", p."name_en", l."counted_qty"
      HAVING SUM(e."qty_delta") <> 0
      ORDER BY MAX(e."created_at") DESC
      LIMIT ${paging.page_size} OFFSET ${(paging.page - 1) * paging.page_size}
    `;
    const items = rows.map((row) => ({
      variant: { id: row.variant_id, sku: row.sku, label: row.label, name_ar: row.name_ar, name_en: row.name_en },
      counted_by_me: quantityNumber(row.mine),
      counted_total: quantityNumber(row.total),
      last_counted_at: row.last_at,
    }));
    return pageOf(items, Number(rows[0]?.all_rows ?? 0), paging);
  }

  /** How many items a count of this scope would cover (the live "{n} items in this scope"). */
  async scopeSize(context: TenantContext, query: ScopeSizeDto, actor: AuthenticatedUser) {
    assertBranchAccess(actor, query.branch_id);
    const scope: CountScope = {
      scope_type: query.scope_type,
      category_id: query.scope_type === 'category' ? query.scope_id! : null,
      product_type_id: query.scope_type === 'product_type' ? query.scope_id! : null,
    };
    if (scope.scope_type !== 'all') {
      const found = scope.scope_type === 'category'
        ? await this.prisma.category.findFirst({ where: { id: scope.category_id!, tenant_id: context.tenantId }, select: { id: true } })
        : await this.prisma.productType.findFirst({ where: { id: scope.product_type_id!, tenant_id: context.tenantId }, select: { id: true } });
      if (!found) throw domainError(NOT_FOUND, 'STOCK_COUNT_SCOPE_NOT_FOUND', 'The category or product type was not found', 'التصنيف أو نوع المنتج غير موجود.');
    }
    return { branch_id: query.branch_id, scope_type: query.scope_type, items: await countScopeItems(this.prisma, context.tenantId, scope) };
  }

  // --- internals --------------------------------------------------------------

  private async header(context: TenantContext, id: string, actor: AuthenticatedUser) {
    const header = await this.prisma.stockCount.findFirst({ where: { id, tenant_id: context.tenantId } });
    if (!header || !hasBranchAccess(actor, header.branch_id)) throw new NotFoundException('Stock count not found');
    return header;
  }

  /**
   * The rows of the review: one per counted line, plus (while the count is open)
   * one per in-scope item nobody counted that holds a non-zero balance.
   */
  private rowsCte(tenantId: string, header: CountScope & { id: string; warehouse_id: string; status: string }): Prisma.Sql {
    const uncounted =
      header.status === 'open'
        ? Prisma.sql`
          UNION ALL
          SELECT v."id", v."sku", v."label", p."name_ar", p."name_en", 'uncounted', NULL::numeric, NULL::numeric, NULL::numeric,
                 s."qty_on_hand", COALESCE(s."avg_cost", v."cost_price"), FALSE, NULL::numeric
          FROM "ProductVariant" v
          JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
          JOIN "InventoryStock" s
            ON s."tenant_id" = v."tenant_id" AND s."warehouse_id" = ${header.warehouse_id}::uuid AND s."variant_id" = v."id"
          WHERE v."tenant_id" = ${tenantId}::uuid
            AND v."is_active" AND p."is_active" AND v."item_type" = 'stocked' AND v."tracking" = 'none'
            AND ${scopePredicate(header)}
            AND s."qty_on_hand" <> 0
            AND NOT EXISTS (
              SELECT 1 FROM "StockCountLine" l
              WHERE l."tenant_id" = v."tenant_id" AND l."count_id" = ${header.id}::uuid AND l."variant_id" = v."id"
            )`
        : Prisma.empty;
    return Prisma.sql`
      WITH "rows" AS (
        SELECT l."variant_id", v."sku", v."label", p."name_ar", p."name_en", 'counted' AS "kind",
               l."expected_qty" AS "expected", l."counted_qty" AS "counted", l."counted_qty" - l."expected_qty" AS "variance",
               COALESCE(s."qty_on_hand", 0) AS "on_hand", COALESCE(l."unit_cost", s."avg_cost", v."cost_price") AS "unit_cost",
               l."zeroed", l."applied_delta"
        FROM "StockCountLine" l
        JOIN "ProductVariant" v ON v."tenant_id" = l."tenant_id" AND v."id" = l."variant_id"
        JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
        LEFT JOIN "InventoryStock" s
          ON s."tenant_id" = l."tenant_id" AND s."warehouse_id" = ${header.warehouse_id}::uuid AND s."variant_id" = l."variant_id"
        WHERE l."tenant_id" = ${tenantId}::uuid AND l."count_id" = ${header.id}::uuid
        ${uncounted}
      )`;
  }

  private filterSql(filter: NonNullable<ReviewCountDto['filter']>): Prisma.Sql {
    switch (filter) {
      case 'variance':
        return Prisma.sql`r."kind" = 'counted' AND r."variance" <> 0`;
      case 'increase':
        return Prisma.sql`r."kind" = 'counted' AND r."variance" > 0`;
      case 'decrease':
        return Prisma.sql`r."kind" = 'counted' AND r."variance" < 0`;
      case 'matched':
        return Prisma.sql`r."kind" = 'counted' AND r."variance" = 0`;
      case 'uncounted':
        return Prisma.sql`r."kind" = 'uncounted'`;
      default:
        return Prisma.sql`TRUE`;
    }
  }

  private async entryStats(tenantId: string, countId: string) {
    const [row] = await this.prisma.$queryRaw<Array<{ active: bigint; unknown: bigint }>>`
      SELECT COUNT(DISTINCT "counted_by") FILTER (WHERE "created_at" > NOW() - INTERVAL '10 minutes') AS "active",
             COUNT(*) FILTER (WHERE "variant_id" IS NULL) AS "unknown"
      FROM "StockCountEntry"
      WHERE "tenant_id" = ${tenantId}::uuid AND "count_id" = ${countId}::uuid
    `;
    return { active_counters: Number(row?.active ?? 0), unknown_scans: Number(row?.unknown ?? 0) };
  }

  /** In-scope item counts of several counts in one statement. */
  private async scopeSizes(tenantId: string, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; items: bigint }>>`
      SELECT c."id", COUNT(v."id") AS "items"
      FROM "StockCount" c
      JOIN "Product" p
        ON p."tenant_id" = c."tenant_id" AND p."is_active"
       AND (c."scope_type" = 'all'
            OR (c."scope_type" = 'category' AND p."category_id" = c."category_id")
            OR (c."scope_type" = 'product_type' AND p."product_type_id" = c."product_type_id"))
      JOIN "ProductVariant" v
        ON v."tenant_id" = p."tenant_id" AND v."product_id" = p."id" AND v."is_active" AND v."item_type" = 'stocked' AND v."tracking" = 'none'
      WHERE c."tenant_id" = ${tenantId}::uuid AND c."id" = ANY(${ids}::uuid[])
      GROUP BY c."id"
    `;
    return new Map(rows.map((row) => [row.id, Number(row.items)]));
  }

  /** The display name of each count's category / product type. */
  private async scopeNames(tenantId: string, counts: Array<{ id: string; category_id: string | null; product_type_id: string | null }>) {
    const categoryIds = counts.flatMap((count) => (count.category_id ? [count.category_id] : []));
    const typeIds = counts.flatMap((count) => (count.product_type_id ? [count.product_type_id] : []));
    const [categories, types] = await Promise.all([
      categoryIds.length ? this.prisma.category.findMany({ where: { tenant_id: tenantId, id: { in: categoryIds } }, select: { id: true, name_ar: true } }) : [],
      typeIds.length ? this.prisma.productType.findMany({ where: { tenant_id: tenantId, id: { in: typeIds } }, select: { id: true, name_ar: true } }) : [],
    ]);
    const named = new Map([...categories, ...types].map((row) => [row.id, row.name_ar]));
    return new Map(counts.map((count) => [count.id, named.get(count.category_id ?? count.product_type_id ?? '') ?? null]));
  }

  private async userNames(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}
