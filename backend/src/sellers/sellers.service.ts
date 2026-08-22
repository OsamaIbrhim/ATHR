import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { money, moneyNumber } from '../common/money';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { businessDateRange } from '../common/business-time';
import {
  UpdateCommissionSettingsDto,
  UpdateSellerCommissionDto,
} from './dto/commission-settings.dto';
import { SellersRepository } from './sellers.repository';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class SellersService {
  constructor(private readonly repository: SellersRepository) {}

  private dateRange(from: string, to: string) {
    return businessDateRange(from, to);
  }

  private periodBounds(from: string, to: string) {
    const range = this.dateRange(from, to);
    return { start: range.gte, endExclusive: range.lt };
  }

  async report(
    context: TenantContext,
    from: string,
    to: string,
    branchId?: string,
    sellerId?: string,
  ) {
    const range = this.dateRange(from, to);
    const [sellers, sales, returns, settings] = await Promise.all([
      this.repository.listSellers(context, branchId, sellerId),
      this.repository.listAttributedSales(context, range, branchId, sellerId),
      this.repository.listAttributedReturns(context, range, branchId, sellerId),
      this.repository.getSettings(context),
    ]);

    const rows = new Map<string, {
      invoiceCount: number;
      gross: Prisma.Decimal;
      returnCount: number;
      refunds: Prisma.Decimal;
    }>();
    for (const seller of sellers) {
      rows.set(seller.id, {
        invoiceCount: 0,
        gross: new Prisma.Decimal(0),
        returnCount: 0,
        refunds: new Prisma.Decimal(0),
      });
    }
    for (const invoice of sales) {
      if (!invoice.seller_id || !rows.has(invoice.seller_id)) continue;
      const row = rows.get(invoice.seller_id)!;
      row.invoiceCount += 1;
      row.gross = row.gross.plus(invoice.subtotal);
    }
    for (const record of returns) {
      const id = record.original_invoice.seller_id;
      if (!id || !rows.has(id)) continue;
      const row = rows.get(id)!;
      row.returnCount += 1;
      row.refunds = row.refunds.plus(record.refund_subtotal);
    }

    return {
      from,
      to,
      branch_id: branchId || null,
      seller_id: sellerId || null,
      rows: sellers.map((seller) => {
        const value = rows.get(seller.id)!;
        const override = seller.seller_commission_override;
        const rate = new Prisma.Decimal(override?.rate ?? settings.default_rate);
        const target = override?.target ?? settings.default_target;
        const bonus = new Prisma.Decimal(override?.bonus ?? settings.default_bonus);
        const net = money(value.gross.minus(value.refunds));
        const percentageCommission = money(net.mul(rate).div(100));
        const targetAchieved = target !== null && net.gte(target);
        const targetBonus = targetAchieved ? money(bonus) : money(0);
        return {
          seller,
          invoice_count: value.invoiceCount,
          gross_sales_before_tax: moneyNumber(value.gross),
          return_count: value.returnCount,
          returns_before_tax: moneyNumber(value.refunds),
          net_sales_before_tax: moneyNumber(net),
          commission_rate: Number(rate.toFixed(2)),
          percentage_commission: moneyNumber(percentageCommission),
          target: target === null ? null : moneyNumber(target),
          target_achieved: targetAchieved,
          target_bonus: moneyNumber(targetBonus),
          estimated_total: moneyNumber(
            money(percentageCommission.plus(targetBonus)),
          ),
        };
      }),
    };
  }

  async settings(context: TenantContext, actor: AuthenticatedUser) {
    const settings = await this.repository.getSettings(context);
    const overrides = await this.repository.listOverrides(
      context,
      actor.role === 'owner' ? undefined : actor.branch_id || undefined,
    );
    return { settings, overrides };
  }

  updateSettings(
    context: TenantContext,
    dto: UpdateCommissionSettingsDto,
    actor: AuthenticatedUser,
  ) {
    if (actor.role !== 'owner') throw new ForbiddenException('Only the owner can change commission defaults');
    return this.repository.updateSettings(context, {
      ...dto,
      period_anchor: new Date(dto.period_anchor),
    });
  }

  async updateSellerSettings(
    context: TenantContext,
    sellerId: string,
    dto: UpdateSellerCommissionDto,
    actor: AuthenticatedUser,
  ) {
    if (actor.role !== 'owner') throw new ForbiddenException('Only the owner can change seller commissions');
    const seller = await this.repository.findSeller(context, sellerId);
    if (!seller) throw new NotFoundException('Seller not found');
    return this.repository.saveOverride(context, sellerId, dto);
  }

  periods(context: TenantContext, actor: AuthenticatedUser) {
    return this.repository.listPeriods(
      context,
      actor.role === 'owner' ? undefined : actor.branch_id || undefined,
    );
  }

  async closePeriod(
    context: TenantContext,
    from: string,
    to: string,
    actor: AuthenticatedUser,
  ) {
    if (actor.role !== 'owner') {
      throw new ForbiddenException('Only the owner can close seller periods');
    }
    const { start, endExclusive } = this.periodBounds(from, to);
    if (endExclusive > new Date()) {
      throw new BadRequestException('Only a completed period can be closed');
    }
    const existing = await this.repository.findPeriod(context, start, endExclusive);
    if (existing) throw new ConflictException('This seller period is already closed');

    const [settings, report] = await Promise.all([
      this.repository.getSettings(context),
      this.report(context, from, to),
    ]);
    return this.repository.savePeriod(context, {
      period_start: start,
      period_end_exclusive: endExclusive,
      period_length_days: settings.period_length_days,
      default_rate: settings.default_rate,
      default_target: settings.default_target,
      default_bonus: settings.default_bonus,
      closed_by: actor.sub,
      rows: {
        // tenant_id is deliberately omitted: SellerCommissionPeriodRow.period
        // is a composite FK on (tenant_id, period_id) (schema.prisma:390), so
        // Prisma's nested-create input for this relation excludes both
        // tenant_id and period_id and auto-fills them from the parent.
        // Passing tenant_id explicitly throws PrismaClientValidationError:
        // Unknown argument tenant_id.
        create: report.rows.map((row) => ({
          seller_id: row.seller.id,
          seller_name: row.seller.name,
          branch_id: row.seller.branch_id,
          branch_name: row.seller.branch?.name_ar || null,
          invoice_count: row.invoice_count,
          gross_sales_before_tax: row.gross_sales_before_tax,
          return_count: row.return_count,
          returns_before_tax: row.returns_before_tax,
          net_sales_before_tax: row.net_sales_before_tax,
          commission_rate: row.commission_rate,
          percentage_commission: row.percentage_commission,
          target: row.target,
          target_achieved: row.target_achieved,
          target_bonus: row.target_bonus,
          estimated_total: row.estimated_total,
        })),
      },
    });
  }
}
