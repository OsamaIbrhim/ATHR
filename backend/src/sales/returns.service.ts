import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { canAccessAllBranches, hasBranchAccess } from '../auth/branch-access';
import { readTenantSettings } from '../catalog/tenant-settings';
import { money, sumMoney, unitCost } from '../common/money';
import { nextDocumentNumber } from '../common/document-sequence';
import { assertQuantityPrecision, quantity, quantityNumber, variantQuantityPrecision } from '../common/quantity';
import { postLedgerEntry } from '../customers/customer-ledger';
import type { TenantContext } from '../identity/tenant-context.type';
import { InventoryService } from '../inventory/inventory.service';
import type { StockLots } from '../inventory/inventory.types';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReturnDto } from './dto/create-return.dto';
import { assertWithinReturnWindow, refundForLine } from './return-refund';
import { loadReturnLots } from './sale-return-lots';

/** What a return links to when it is part of an exchange. */
export interface ReturnLink {
  readonly newInvoiceId?: string;
}

@Injectable()
export class ReturnsService {
  constructor(
    private prisma: PrismaService,
    private costVisibility: CostVisibilityService,
    private inventory: InventoryService,
  ) {}

  async createReturn(context: TenantContext, dto: CreateReturnDto, actor: AuthenticatedUser) {
    const result = await this.prisma.$transaction((tx) => this.bookReturn(tx, context, dto, actor), {
      maxWait: 5_000,
      timeout: 20_000,
    });
    return this.forActor(result, actor);
  }

  /**
   * `ReturnItem.unit_cost` is copied from the sale line it reverses, so the
   * return response is the same disclosure under a different table. Gated,
   * not unconditional: unlike `POST /pos/sale` this endpoint authenticates an
   * actor, so a `location_manager` posting a return still sees the figure.
   */
  async forActor<T extends { items: Array<{ unit_cost?: unknown }> }>(record: T, actor: AuthenticatedUser) {
    if (await this.costVisibility.canViewSaleCostMargin(actor)) return record;
    return { ...record, items: record.items.map(({ unit_cost: _unitCost, ...item }) => item) };
  }

  /**
   * Records a return inside the caller's transaction (an exchange books its new
   * sale in the same one). The refund is what was paid for the returned units:
   * a share of each line's stored net (after its discount) and tax. It goes back
   * the way `dto.refund_method` says; `credit` lowers what the customer owes.
   */
  async bookReturn(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    dto: CreateReturnDto,
    actor: AuthenticatedUser,
    link: ReturnLink = {},
  ) {
    const requested = new Map<string, Prisma.Decimal>();
    const requestedSerials = new Map<string, string[]>();
    for (const item of dto.items) {
      requested.set(
        item.sales_invoice_item_id,
        (requested.get(item.sales_invoice_item_id) ?? new Prisma.Decimal(0)).plus(quantity(item.qty)),
      );
      if (item.serials?.length) {
        requestedSerials.set(item.sales_invoice_item_id, [...(requestedSerials.get(item.sales_invoice_item_id) ?? []), ...item.serials]);
      }
    }
    const saleItemIds = [...requested.keys()].sort();
    const refundMethod = dto.refund_method ?? 'cash';

    const original = await tx.salesInvoice.findFirst({
      where: { tenant_id: context.tenantId, id: dto.original_invoice_id },
      include: {
        items: {
          include: { variant: { select: { item_type: true, tracking: true, base_uom: { select: { precision: true } } } } },
        },
      },
    });
    if (!original) throw new NotFoundException('Original invoice not found');
    if (!hasBranchAccess(actor, original.branch_id)) {
      throw new ForbiddenException('You cannot return a sale from another branch');
    }
    if (refundMethod === 'credit' && !original.customer_id) {
      throw new BadRequestException({
        code: 'REFUND_TO_CREDIT_NEEDS_CUSTOMER',
        message_ar: 'لا يمكن الرد على الحساب لأن الفاتورة بلا عميل.',
        message: 'A refund to the customer account needs an invoice with a customer',
      });
    }

    let shiftId: string | null = null;
    // A tenant-wide actor (owner) may return without a till shift.
    if (!canAccessAllBranches(actor)) {
      const currentShift = await tx.shift.findFirst({
        where: { tenant_id: context.tenantId, branch_id: original.branch_id, status: 'open' },
        select: { id: true },
      });
      if (!currentShift) {
        throw new ConflictException('An open shift is required to record a POS return');
      }
      shiftId = currentShift.id;
    }

    const tenant = await tx.tenant.findUnique({ where: { id: context.tenantId }, select: { settings: true } });
    assertWithinReturnWindow(
      original.occurred_at || original.created_at,
      readTenantSettings(tenant?.settings).sales.return_window_days,
    );

    const soldById = new Map(original.items.map((item) => [item.id, item]));
    for (const saleItemId of saleItemIds) {
      if (!soldById.has(saleItemId)) {
        throw new BadRequestException(`Item ${saleItemId} does not belong to the original invoice`);
      }
    }
    // Two statements for every line: lock the sold lines, then read what was already returned.
    await tx.$queryRaw`
      SELECT "id"
      FROM "SalesInvoiceItem"
      WHERE "tenant_id" = ${context.tenantId}::uuid AND "id" = ANY(${saleItemIds}::uuid[])
      ORDER BY "id"
      FOR UPDATE
    `;
    const returnedRows = await tx.returnItem.groupBy({
      by: ['sales_invoice_item_id'],
      where: {
        tenant_id: context.tenantId,
        sales_invoice_item_id: { in: saleItemIds },
        return_record: { status: 'completed' },
      },
      _sum: { qty: true },
    });
    const returnedBefore = new Map(
      returnedRows.map((row) => [row.sales_invoice_item_id, row._sum.qty ?? new Prisma.Decimal(0)]),
    );

    const returnItems = [...requested].map(([saleItemId, qty]) => {
      const soldItem = soldById.get(saleItemId)!;
      assertQuantityPrecision(qty, variantQuantityPrecision(soldItem.variant), saleItemId);
      const before = returnedBefore.get(saleItemId) ?? new Prisma.Decimal(0);
      const remaining = soldItem.qty.minus(before);
      if (qty.gt(remaining)) {
        throw new ConflictException(`Only ${quantityNumber(remaining)} unit(s) remain returnable for item ${saleItemId}`);
      }
      const refund = refundForLine(soldItem, before, qty);
      return {
        sales_invoice_item_id: saleItemId,
        variant_id: soldItem.variant_id,
        qty,
        unit_price: money(soldItem.unit_price),
        unit_cost: unitCost(soldItem.unit_cost),
        unit_tax: money(soldItem.unit_tax),
        net_amount: refund.net,
        tax_amount: refund.tax,
      };
    });

    const refundSubtotal = sumMoney(returnItems.map((item) => item.net_amount));
    const refundTax = sumMoney(returnItems.map((item) => item.tax_amount));
    const refundTotal = money(refundSubtotal.plus(refundTax));
    const sumQty = (values: Prisma.Decimal[]) => values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
    const originalQty = sumQty(original.items.map((item) => item.qty));

    const returnRecord = await tx.return.create({
      data: {
        tenant_id: context.tenantId,
        original_invoice_id: original.id,
        new_invoice_id: link.newInvoiceId ?? null,
        branch_id: original.branch_id,
        shift_id: shiftId,
        return_invoice_number: await nextDocumentNumber(tx, context.tenantId, 'return'),
        reason: dto.reason,
        is_partial: sumQty(returnItems.map((item) => item.qty)).lt(originalQty),
        created_by: actor.sub,
        refund_subtotal: refundSubtotal,
        refund_tax: refundTax,
        refund_total: refundTotal,
        refund_method: refundMethod,
        status: 'completed',
        items: { create: returnItems },
      },
      include: { items: true },
    });

    await this.restock(tx, context, actor, original, returnRecord, soldById, requested, requestedSerials, returnedBefore);

    // A variant returned three or more times is flagged for QA.
    const returnedUnits = new Map<string, number>();
    for (const item of returnItems) {
      returnedUnits.set(item.variant_id, (returnedUnits.get(item.variant_id) ?? 0) + Math.ceil(item.qty.toNumber()));
    }
    await tx.$executeRaw`
      UPDATE "ProductVariant" v
      SET "return_count" = v."return_count" + u."units",
          "qa_flag" = v."qa_flag" OR v."return_count" + u."units" >= 3
      FROM unnest(${[...returnedUnits.keys()]}::uuid[], ${[...returnedUnits.values()]}::int[]) AS u("variant_id", "units")
      WHERE v."tenant_id" = ${context.tenantId}::uuid AND v."id" = u."variant_id"
    `;

    if (original.customer_id) {
      const customer = await tx.customer.findFirst({ where: { tenant_id: context.tenantId, id: original.customer_id } });
      if (customer) {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            total_spent: Prisma.Decimal.max(new Prisma.Decimal(0), new Prisma.Decimal(customer.total_spent).minus(refundTotal)),
          },
        });
      }
    }
    // Refunded onto the account: the customer owes that much less.
    if (refundMethod === 'credit' && original.customer_id && refundTotal.greaterThan(0)) {
      await postLedgerEntry(tx, {
        tenantId: context.tenantId,
        customerId: original.customer_id,
        type: 'refund_credit',
        amount: refundTotal.negated(),
        returnId: returnRecord.id,
        shiftId,
        createdBy: actor.sub,
      });
    }

    return returnRecord;
  }

  /** Goods come back at the cost they were sold at (moving average), one stock line per variant. */
  private async restock(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    actor: AuthenticatedUser,
    original: { id: string; branch_id: string },
    returnRecord: { id: string; created_at: Date; return_invoice_number: string; items: Array<{ id: string; sales_invoice_item_id: string; variant_id: string; qty: Prisma.Decimal; unit_cost: Prisma.Decimal }> },
    soldById: Map<string, { variant_id: string; qty: Prisma.Decimal; variant: { item_type: string; tracking?: string } }>,
    requested: Map<string, Prisma.Decimal>,
    requestedSerials: Map<string, string[]>,
    returnedBefore: Map<string, Prisma.Decimal>,
  ) {
    // Serial / batch variants go back to the lots their sale line drew.
    const warehouseId = await this.inventory.defaultWarehouseId(tx, context.tenantId, original.branch_id);
    const returnLots = await loadReturnLots({
      inventory: this.inventory,
      tx,
      tenantId: context.tenantId,
      invoiceId: original.id,
      warehouseId,
      requested,
      serials: requestedSerials,
      sold: soldById,
      returnedBefore,
    });

    const stockLines = new Map<string, { qty: Prisma.Decimal; value: Prisma.Decimal; lineId: string; lots?: StockLots }>();
    for (const item of returnRecord.items) {
      if (soldById.get(item.sales_invoice_item_id)!.variant.item_type !== 'stocked') continue;
      const line = stockLines.get(item.variant_id) ?? {
        qty: new Prisma.Decimal(0),
        value: new Prisma.Decimal(0),
        lineId: item.id,
        lots: returnLots.get(item.sales_invoice_item_id),
      };
      line.qty = line.qty.plus(item.qty);
      line.value = line.value.plus(item.unit_cost.mul(item.qty));
      stockLines.set(item.variant_id, line);
    }
    await this.inventory.apply(tx, {
      tenantId: context.tenantId,
      warehouseId,
      occurredAt: returnRecord.created_at,
      actorId: actor.sub,
      type: 'return',
      costType: 'customer_return',
      reference: { type: 'Return', id: returnRecord.id },
      idempotencyKey: `return:${returnRecord.id}`,
      allowNegative: true,
      metadata: { return_invoice_number: returnRecord.return_invoice_number, original_invoice_id: original.id },
      lines: [...stockLines].map(([variantId, line]) => ({
        variantId,
        qtyDelta: line.qty,
        referenceLineId: line.lineId,
        unitCost: unitCost(line.value.div(line.qty)),
        value: line.value,
        ...(line.lots ? { lots: line.lots } : {}),
      })),
    });
  }
}
