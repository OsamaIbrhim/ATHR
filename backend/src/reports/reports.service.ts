import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  decimal,
  lineMoney,
  money,
  moneyNumber,
  sumMoney,
} from '../common/money';
import { businessDateRange } from '../common/business-time';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private dateRange(from: string, to: string) {
    return businessDateRange(from, to);
  }

  async sales(context: TenantContext, from: string, to: string, branch_id?: string) {
    const where: any = {
      tenant_id: context.tenantId,
      status: 'completed',
      occurred_at: this.dateRange(from, to),
    };
    if (branch_id) where.branch_id = branch_id;
    const invoices = await this.prisma.salesInvoice.findMany({
      where,
      include: { items: true },
    });
    const returnWhere: any = {
      tenant_id: context.tenantId,
      status: 'completed',
      created_at: this.dateRange(from, to),
    };
    if (branch_id) returnWhere.branch_id = branch_id;
    const returns = await this.prisma.return.findMany({
      where: returnWhere,
      include: { items: true },
    });

    const grossSales = sumMoney(invoices.map((invoice) => invoice.total));
    const netRevenueBeforeRefunds = sumMoney(
      invoices.map((invoice) => invoice.subtotal),
    );
    const taxCollected = sumMoney(
      invoices.map((invoice) => invoice.tax_amount),
    );
    const soldCost = sumMoney(
      invoices
        .flatMap((invoice) => invoice.items)
        .map((item) => lineMoney(item.unit_cost, item.qty)),
    );
    const refundTotal = sumMoney(
      returns.map((record) => record.refund_total),
    );
    const refundSubtotal = sumMoney(
      returns.map((record) => record.refund_subtotal),
    );
    const refundTax = sumMoney(
      returns.map((record) => record.refund_tax),
    );
    const returnedCost = sumMoney(
      returns
        .flatMap((record) => record.items)
        .map((item) => lineMoney(item.unit_cost, item.qty)),
    );

    const totalSales = money(grossSales.minus(refundTotal));
    const totalCost = money(soldCost.minus(returnedCost));
    const netRevenue = money(
      netRevenueBeforeRefunds.minus(refundSubtotal),
    );
    const totalTax = money(taxCollected.minus(refundTax));
    const profit = money(netRevenue.minus(totalCost));
    return {
      count: invoices.length,
      return_count: returns.length,
      gross_sales: moneyNumber(grossSales),
      refunds: moneyNumber(refundTotal),
      total_sales: moneyNumber(totalSales),
      net_revenue: moneyNumber(netRevenue),
      total_tax: moneyNumber(totalTax),
      total_cost: moneyNumber(totalCost),
      profit: moneyNumber(profit),
      invoices,
      returns,
    };
  }

  async bestSellers(context: TenantContext, branch_id?: string, limit = 20) {
    const items = await this.prisma.salesInvoiceItem.findMany({
      where: {
        tenant_id: context.tenantId,
        invoice: {
          tenant_id: context.tenantId,
          status: 'completed',
          ...(branch_id ? { branch_id } : {}),
        },
      },
      include: { variant: { include: { product: true } } },
    });
    const returnedItems = await this.prisma.returnItem.findMany({
      where: {
        tenant_id: context.tenantId,
        return_record: {
          tenant_id: context.tenantId,
          status: 'completed',
          ...(branch_id ? { branch_id } : {}),
        },
      },
      include: { variant: { include: { product: true } } },
    });
    const map = new Map<
      string,
      { qty: number; name: string; profit: Prisma.Decimal }
    >();
    for (const item of items) {
      const key = item.variant_id;
      const previous = map.get(key) || {
        qty: 0,
        name: item.variant?.product?.name_en || key,
        profit: new Prisma.Decimal(0),
      };
      const profit = lineMoney(
        decimal(item.unit_price).minus(item.unit_cost),
        item.qty,
      );
      map.set(key, {
        qty: previous.qty + item.qty,
        name: previous.name,
        profit: previous.profit.plus(profit),
      });
    }
    for (const item of returnedItems) {
      const key = item.variant_id;
      const previous = map.get(key) || {
        qty: 0,
        name: item.variant?.product?.name_en || key,
        profit: new Prisma.Decimal(0),
      };
      const profit = lineMoney(
        decimal(item.unit_price).minus(item.unit_cost),
        item.qty,
      );
      map.set(key, {
        qty: previous.qty - item.qty,
        name: previous.name,
        profit: previous.profit.minus(profit),
      });
    }
    return [...map.entries()]
      .map(([variant_id, value]) => ({
        variant_id,
        ...value,
        profit: moneyNumber(value.profit),
      }))
      .filter((item) => item.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);
  }

  async profitByItem(context: TenantContext, from: string, to: string, branch_id?: string) {
    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        tenant_id: context.tenantId,
        status: 'completed',
        occurred_at: this.dateRange(from, to),
        ...(branch_id ? { branch_id } : {}),
      },
      include: {
        items: { include: { variant: { include: { product: true } } } },
      },
    });
    const returnedItems = await this.prisma.returnItem.findMany({
      where: {
        tenant_id: context.tenantId,
        return_record: {
          tenant_id: context.tenantId,
          status: 'completed',
          created_at: this.dateRange(from, to),
          ...(branch_id ? { branch_id } : {}),
        },
      },
      include: { variant: { include: { product: true } } },
    });
    const map = new Map<
      string,
      {
        variant_id: string;
        name: string;
        qty: number;
        revenue: Prisma.Decimal;
        cost: Prisma.Decimal;
        profit: Prisma.Decimal;
      }
    >();
    for (const invoice of invoices) {
      for (const item of invoice.items) {
        const key = item.variant_id;
        const name =
          item.variant?.product?.name_en +
          ' ' +
          [item.variant?.size, item.variant?.color].filter(Boolean).join('/');
        const revenue = lineMoney(item.unit_price, item.qty);
        const cost = lineMoney(item.unit_cost, item.qty);
        const previous = map.get(key) || {
          variant_id: key,
          name,
          qty: 0,
          revenue: new Prisma.Decimal(0),
          cost: new Prisma.Decimal(0),
          profit: new Prisma.Decimal(0),
        };
        map.set(key, {
          variant_id: key,
          name,
          qty: previous.qty + item.qty,
          revenue: previous.revenue.plus(revenue),
          cost: previous.cost.plus(cost),
          profit: previous.profit.plus(revenue).minus(cost),
        });
      }
    }
    for (const item of returnedItems) {
      const key = item.variant_id;
      const name =
        item.variant?.product?.name_en +
        ' ' +
        [item.variant?.size, item.variant?.color].filter(Boolean).join('/');
      const revenue = lineMoney(item.unit_price, item.qty);
      const cost = lineMoney(item.unit_cost, item.qty);
      const previous = map.get(key) || {
        variant_id: key,
        name,
        qty: 0,
        revenue: new Prisma.Decimal(0),
        cost: new Prisma.Decimal(0),
        profit: new Prisma.Decimal(0),
      };
      map.set(key, {
        variant_id: key,
        name,
        qty: previous.qty - item.qty,
        revenue: previous.revenue.minus(revenue),
        cost: previous.cost.minus(cost),
        profit: previous.profit.minus(revenue).plus(cost),
      });
    }
    return Array.from(map.values())
      .sort((a, b) => b.profit.comparedTo(a.profit))
      .map((item) => ({
        ...item,
        revenue: moneyNumber(item.revenue),
        cost: moneyNumber(item.cost),
        profit: moneyNumber(item.profit),
      }));
  }

  async inventoryValuation(context: TenantContext, branch_id?: string) {
    const stock = await this.prisma.inventoryStock.findMany({
      where: {
        tenant_id: context.tenantId,
        qty_on_hand: { gt: 0 },
        ...(branch_id ? { branch_id } : {}),
      },
      include: {
        variant: { include: { product: true } },
        branch: true,
      },
    });
    const preciseRows = stock.map((record) => ({
      branch: record.branch.name_ar,
      sku: record.variant.sku,
      product: record.variant.product.name_en,
      size: record.variant.size,
      color: record.variant.color,
      qty: record.qty_on_hand,
      cost_price: money(record.variant.cost_price),
      value: lineMoney(record.variant.cost_price, record.qty_on_hand),
    }));
    const totalValue = sumMoney(preciseRows.map((row) => row.value));
    const rows = preciseRows.map((row) => ({
      ...row,
      cost_price: moneyNumber(row.cost_price),
      value: moneyNumber(row.value),
    }));
    const total_qty = rows.reduce((sum, row) => sum + row.qty, 0);
    return { total_qty, total_value: moneyNumber(totalValue), rows };
  }
}
