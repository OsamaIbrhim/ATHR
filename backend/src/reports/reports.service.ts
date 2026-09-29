import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { money, moneyNumber } from '../common/money';
import { businessDateRange } from '../common/business-time';
import { quantityNumber } from '../common/quantity';
import type { TenantContext } from '../identity/tenant-context.type';

/** A report window is required and bounded: an open range would scan the whole ledger. */
export const MAX_REPORT_SPAN_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TOP = 20;
const DEFAULT_PROFIT_ROWS = 200;
const MAX_ROWS = 1000;
const DEFAULT_PAGE_SIZE = 100;

/** `?limit=` style inputs arrive as strings; anything unusable falls back to the default. */
function clampInt(value: number | string | undefined, fallback: number, max: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

/**
 * Reports are GROUP BY queries in Postgres — the app never loads ledger rows.
 * Money is summed per line exactly as the app rounds it (`round(unit * qty, 2)`,
 * half away from zero = `lineMoney`), so figures match the invoices to the cent.
 */
@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private dateRange(from: string, to: string) {
    const range = businessDateRange(from, to);
    if (range.lt.getTime() - range.gte.getTime() > MAX_REPORT_SPAN_DAYS * DAY_MS) {
      throw new BadRequestException(`Report range cannot exceed ${MAX_REPORT_SPAN_DAYS} days`);
    }
    return range;
  }

  /** The completed sale lines and completed return lines of the window, sold as + and returned as -. */
  private movementLines(
    context: TenantContext,
    range: { gte: Date; lt: Date },
    branchId?: string,
  ) {
    const saleBranch = branchId ? Prisma.sql`AND i."branch_id" = ${branchId}::uuid` : Prisma.empty;
    const returnBranch = branchId ? Prisma.sql`AND r."branch_id" = ${branchId}::uuid` : Prisma.empty;
    return Prisma.sql`
      SELECT it."variant_id", it."qty",
             round(it."unit_price" * it."qty", 2) AS revenue,
             round(it."unit_cost" * it."qty", 2) AS cost,
             round((it."unit_price" - it."unit_cost") * it."qty", 2) AS margin
      FROM "SalesInvoice" i
      JOIN "SalesInvoiceItem" it ON it."tenant_id" = i."tenant_id" AND it."sales_invoice_id" = i."id"
      WHERE i."tenant_id" = ${context.tenantId}::uuid AND i."status" = 'completed'
        AND i."occurred_at" >= ${range.gte} AND i."occurred_at" < ${range.lt} ${saleBranch}
      UNION ALL
      SELECT ri."variant_id", -ri."qty",
             -round(ri."unit_price" * ri."qty", 2),
             -round(ri."unit_cost" * ri."qty", 2),
             -round((ri."unit_price" - ri."unit_cost") * ri."qty", 2)
      FROM "Return" r
      JOIN "ReturnItem" ri ON ri."tenant_id" = r."tenant_id" AND ri."return_id" = r."id"
      WHERE r."tenant_id" = ${context.tenantId}::uuid AND r."status" = 'completed'
        AND r."created_at" >= ${range.gte} AND r."created_at" < ${range.lt} ${returnBranch}`;
  }

  async sales(context: TenantContext, from: string, to: string, branch_id?: string) {
    const range = this.dateRange(from, to);
    const saleBranch = branch_id ? Prisma.sql`AND i."branch_id" = ${branch_id}::uuid` : Prisma.empty;
    const returnBranch = branch_id ? Prisma.sql`AND r."branch_id" = ${branch_id}::uuid` : Prisma.empty;

    const [[sold], [returned], [lines]] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        count: number;
        gross: Prisma.Decimal;
        subtotal: Prisma.Decimal;
        tax: Prisma.Decimal;
      }>>`
        SELECT count(*)::int AS count,
               coalesce(sum(i."total"), 0) AS gross,
               coalesce(sum(i."subtotal"), 0) AS subtotal,
               coalesce(sum(i."tax_amount"), 0) AS tax
        FROM "SalesInvoice" i
        WHERE i."tenant_id" = ${context.tenantId}::uuid AND i."status" = 'completed'
          AND i."occurred_at" >= ${range.gte} AND i."occurred_at" < ${range.lt} ${saleBranch}`,
      this.prisma.$queryRaw<Array<{
        count: number;
        total: Prisma.Decimal;
        subtotal: Prisma.Decimal;
        tax: Prisma.Decimal;
      }>>`
        SELECT count(*)::int AS count,
               coalesce(sum(r."refund_total"), 0) AS total,
               coalesce(sum(r."refund_subtotal"), 0) AS subtotal,
               coalesce(sum(r."refund_tax"), 0) AS tax
        FROM "Return" r
        WHERE r."tenant_id" = ${context.tenantId}::uuid AND r."status" = 'completed'
          AND r."created_at" >= ${range.gte} AND r."created_at" < ${range.lt} ${returnBranch}`,
      // Cost of goods sold net of returned goods: returned lines are already negative.
      this.prisma.$queryRaw<Array<{ cost: Prisma.Decimal }>>`
        SELECT coalesce(sum(l."cost"), 0) AS cost
        FROM (${this.movementLines(context, range, branch_id)}) l`,
    ]);

    const totalSales = money(sold.gross.minus(returned.total));
    const totalCost = money(lines.cost);
    const netRevenue = money(sold.subtotal.minus(returned.subtotal));
    const totalTax = money(sold.tax.minus(returned.tax));
    return {
      count: sold.count,
      return_count: returned.count,
      gross_sales: moneyNumber(sold.gross),
      refunds: moneyNumber(returned.total),
      total_sales: moneyNumber(totalSales),
      net_revenue: moneyNumber(netRevenue),
      total_tax: moneyNumber(totalTax),
      total_cost: moneyNumber(totalCost),
      profit: moneyNumber(netRevenue.minus(totalCost)),
    };
  }

  /** Net quantity sold (sales minus returns) over the window, best first. */
  async bestSellers(
    context: TenantContext,
    from: string,
    to: string,
    branch_id?: string,
    limit?: number | string,
  ) {
    const range = this.dateRange(from, to);
    const rows = await this.prisma.$queryRaw<Array<{
      variant_id: string;
      qty: Prisma.Decimal;
      profit: Prisma.Decimal;
    }>>`
      SELECT l."variant_id", sum(l."qty") AS qty, sum(l."margin") AS profit
      FROM (${this.movementLines(context, range, branch_id)}) l
      GROUP BY l."variant_id"
      HAVING sum(l."qty") > 0
      ORDER BY sum(l."qty") DESC, l."variant_id"
      LIMIT ${clampInt(limit, DEFAULT_TOP, MAX_ROWS)}`;
    const names = await this.variantNames(context, rows.map((row) => row.variant_id));
    return rows.map((row) => ({
      variant_id: row.variant_id,
      name: names.get(row.variant_id)?.product ?? row.variant_id,
      qty: quantityNumber(row.qty),
      profit: moneyNumber(row.profit),
    }));
  }

  async profitByItem(
    context: TenantContext,
    from: string,
    to: string,
    branch_id?: string,
    limit?: number | string,
  ) {
    const range = this.dateRange(from, to);
    const rows = await this.prisma.$queryRaw<Array<{
      variant_id: string;
      qty: Prisma.Decimal;
      revenue: Prisma.Decimal;
      cost: Prisma.Decimal;
    }>>`
      SELECT l."variant_id", sum(l."qty") AS qty, sum(l."revenue") AS revenue, sum(l."cost") AS cost
      FROM (${this.movementLines(context, range, branch_id)}) l
      GROUP BY l."variant_id"
      ORDER BY sum(l."revenue" - l."cost") DESC, l."variant_id"
      LIMIT ${clampInt(limit, DEFAULT_PROFIT_ROWS, MAX_ROWS)}`;
    const names = await this.variantNames(context, rows.map((row) => row.variant_id));
    return rows.map((row) => ({
      variant_id: row.variant_id,
      name: names.get(row.variant_id)?.label ?? row.variant_id,
      qty: quantityNumber(row.qty),
      revenue: moneyNumber(row.revenue),
      cost: moneyNumber(row.cost),
      profit: moneyNumber(row.revenue.minus(row.cost)),
    }));
  }

  /** Names for the (few) variants a report ends up showing. */
  private async variantNames(context: TenantContext, variantIds: string[]) {
    const variants = variantIds.length
      ? await this.prisma.productVariant.findMany({
          where: { tenant_id: context.tenantId, id: { in: variantIds } },
          select: { id: true, label: true, product: { select: { name_en: true } } },
        })
      : [];
    return new Map(
      variants.map((variant) => [
        variant.id,
        {
          product: variant.product.name_en || variant.id,
          label: [variant.product.name_en, variant.label].filter(Boolean).join(' '),
        },
      ]),
    );
  }

  /**
   * Stock on hand valued at each warehouse's moving-average cost. The totals
   * cover every stocked row; `rows` is one page of them.
   */
  async inventoryValuation(
    context: TenantContext,
    branch_id?: string,
    page?: number | string,
    pageSize?: number | string,
  ) {
    const size = clampInt(pageSize, DEFAULT_PAGE_SIZE, MAX_ROWS);
    const current = clampInt(page, 1, Number.MAX_SAFE_INTEGER);
    const where: Prisma.InventoryStockWhereInput = {
      tenant_id: context.tenantId,
      qty_on_hand: { gt: 0 },
      ...(branch_id ? { warehouse: { branch_id } } : {}),
    };
    const branchJoin = branch_id
      ? Prisma.sql`JOIN "Warehouse" w ON w."tenant_id" = s."tenant_id" AND w."id" = s."warehouse_id" AND w."branch_id" = ${branch_id}::uuid`
      : Prisma.empty;
    const [[totals], stock] = await Promise.all([
      this.prisma.$queryRaw<Array<{ total: number; qty: Prisma.Decimal; value: Prisma.Decimal }>>`
        SELECT count(*)::int AS total, coalesce(sum(s."qty_on_hand"), 0) AS qty,
               coalesce(sum(round(s."avg_cost" * s."qty_on_hand", 2)), 0) AS value
        FROM "InventoryStock" s ${branchJoin}
        WHERE s."tenant_id" = ${context.tenantId}::uuid AND s."qty_on_hand" > 0`,
      this.prisma.inventoryStock.findMany({
        where,
        include: {
          variant: { include: { product: true } },
          warehouse: { include: { branch: true } },
        },
        orderBy: [{ warehouse_id: 'asc' }, { variant_id: 'asc' }],
        skip: (current - 1) * size,
        take: size,
      }),
    ]);
    const rows = stock.map((record) => ({
      branch: record.warehouse.branch?.name_ar ?? record.warehouse.name,
      sku: record.variant.sku,
      product: record.variant.product.name_en,
      label: record.variant.label,
      qty: quantityNumber(record.qty_on_hand),
      cost_price: moneyNumber(record.avg_cost),
      value: moneyNumber(money(record.avg_cost.mul(record.qty_on_hand))),
    }));
    return {
      total_qty: quantityNumber(totals.qty),
      total_value: moneyNumber(totals.value),
      rows,
      total: totals.total,
      page: current,
      page_size: size,
      total_pages: Math.max(1, Math.ceil(totals.total / size)),
    };
  }
}
