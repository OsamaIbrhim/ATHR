import { Injectable } from '@nestjs/common';
import type { Prisma, SellerCommissionSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantScope } from '../identity/tenant-context.type';

/**
 * WP-007 Phase A §A.3.2 — tenant-scoped repository for the `sellers` module.
 *
 * Two structural cross-tenant problems live in this module's tables, both
 * inherited from the single-tenant schema:
 *
 * 1. `SellerCommissionSettings.id` is `Int @id @default(1)` — a deliberate
 *    singleton. Every tenant would otherwise share one commission-rate row,
 *    so changing a rate in one tenant silently repays every seller in every
 *    other tenant. Fixed here at the application layer by keying on
 *    `tenant_id` and allocating a fresh primary key per tenant; the column
 *    stays exactly as it is, since schema changes are Phase B (§A.4).
 *
 * 2. `SellerCommissionPeriod` carries `@@unique([period_start,
 *    period_end_exclusive])` — a *global* unique. Every read here is
 *    tenant-scoped, but the database constraint itself still spans tenants,
 *    so a second tenant closing the same calendar period would be rejected
 *    by Postgres. That is exactly the class of constraint Phase B converts
 *    to tenant-scoped uniqueness (§B.4 item 3); it cannot be fixed in this
 *    phase and is recorded in the PR description as a known Phase B item.
 */
@Injectable()
export class SellersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Scoped through the Membership join — `User` has no `tenant_id` (ADR-0003). */
  private tenantMembers(context: TenantScope): Prisma.UserWhereInput {
    return { memberships: { some: { tenantId: context.tenantId } } };
  }

  async listSellers(context: TenantScope, branchId?: string, sellerId?: string) {
    return this.prisma.user.findMany({
      where: {
        ...this.tenantMembers(context),
        role: 'seller',
        ...(branchId ? { branch_id: branchId } : {}),
        ...(sellerId ? { id: sellerId } : {}),
      },
      select: {
        id: true, name: true, branch_id: true, is_active: true,
        branch: { select: { id: true, code: true, name_ar: true } },
        seller_commission_override: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  async findSeller(context: TenantScope, sellerId: string) {
    return this.prisma.user.findFirst({
      where: { id: sellerId, role: 'seller', ...this.tenantMembers(context) },
      select: { id: true },
    });
  }

  async listAttributedSales(
    context: TenantScope,
    range: { gte: Date; lt: Date },
    branchId?: string,
    sellerId?: string,
  ) {
    return this.prisma.salesInvoice.findMany({
      where: {
        tenant_id: context.tenantId,
        status: 'completed',
        occurred_at: range,
        seller_id: { not: null },
        ...(branchId ? { branch_id: branchId } : {}),
        ...(sellerId ? { seller_id: sellerId } : {}),
      },
      select: { seller_id: true, subtotal: true },
    });
  }

  async listAttributedReturns(
    context: TenantScope,
    range: { gte: Date; lt: Date },
    branchId?: string,
    sellerId?: string,
  ) {
    return this.prisma.return.findMany({
      where: {
        tenant_id: context.tenantId,
        status: 'completed',
        created_at: range,
        original_invoice: {
          tenant_id: context.tenantId,
          seller_id: { not: null },
          ...(sellerId ? { seller_id: sellerId } : {}),
        },
        ...(branchId ? { branch_id: branchId } : {}),
      },
      select: {
        refund_subtotal: true,
        original_invoice: { select: { seller_id: true } },
      },
    });
  }

  /**
   * Per-tenant commission settings on a table whose primary key defaults to
   * the constant 1. Reads by `tenant_id`; on first use for a tenant it
   * allocates the next free integer key rather than colliding on id=1.
   *
   * The allocate-on-miss path can race two concurrent first-ever requests for
   * the same tenant; the loser's unique-violation is retried as a read. There
   * is no per-tenant unique index to lean on until Phase B.
   */
  async getSettings(context: TenantScope): Promise<SellerCommissionSettings> {
    const existing = await this.prisma.sellerCommissionSettings.findFirst({
      where: { tenant_id: context.tenantId },
    });
    if (existing) return existing;

    const highest = await this.prisma.sellerCommissionSettings.aggregate({ _max: { id: true } });
    try {
      return await this.prisma.sellerCommissionSettings.create({
        data: { id: (highest._max.id ?? 0) + 1, tenant_id: context.tenantId },
      });
    } catch (error: unknown) {
      const raced = await this.prisma.sellerCommissionSettings.findFirst({
        where: { tenant_id: context.tenantId },
      });
      if (raced) return raced;
      throw error;
    }
  }

  async updateSettings(
    context: TenantScope,
    data: Omit<Prisma.SellerCommissionSettingsUncheckedUpdateInput, 'id' | 'tenant_id'>,
  ) {
    const settings = await this.getSettings(context);
    return this.prisma.sellerCommissionSettings.update({
      where: { id: settings.id },
      data,
    });
  }

  async listOverrides(context: TenantScope, branchId?: string) {
    return this.prisma.sellerCommissionOverride.findMany({
      where: {
        tenant_id: context.tenantId,
        seller: {
          ...this.tenantMembers(context),
          ...(branchId ? { branch_id: branchId } : {}),
        },
      },
      include: { seller: { select: { id: true, name: true, branch_id: true } } },
      orderBy: { seller: { name: 'asc' } },
    });
  }

  async saveOverride(
    context: TenantScope,
    sellerId: string,
    data: Pick<Prisma.SellerCommissionOverrideUncheckedCreateInput, 'rate' | 'target' | 'bonus'>,
  ) {
    return this.prisma.sellerCommissionOverride.upsert({
      where: { seller_id: sellerId },
      create: { seller_id: sellerId, tenant_id: context.tenantId, ...data },
      update: data,
    });
  }

  async listPeriods(context: TenantScope, branchId?: string) {
    return this.prisma.sellerCommissionPeriod.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(branchId ? { rows: { some: { branch_id: branchId } } } : {}),
      },
      include: {
        closer: { select: { id: true, name: true } },
        rows: {
          where: {
            tenant_id: context.tenantId,
            ...(branchId ? { branch_id: branchId } : {}),
          },
          orderBy: [{ seller_name: 'asc' }, { seller_id: 'asc' }],
        },
      },
      orderBy: { closed_at: 'desc' },
      take: 24,
    });
  }

  async findPeriod(context: TenantScope, start: Date, endExclusive: Date) {
    return this.prisma.sellerCommissionPeriod.findFirst({
      where: {
        tenant_id: context.tenantId,
        period_start: start,
        period_end_exclusive: endExclusive,
      },
      select: { id: true },
    });
  }

  async savePeriod(
    context: TenantScope,
    data: Omit<Prisma.SellerCommissionPeriodUncheckedCreateInput, 'tenant_id' | 'rows'> & {
      rows: { create: Prisma.SellerCommissionPeriodRowUncheckedCreateWithoutPeriodInput[] };
    },
  ) {
    return this.prisma.sellerCommissionPeriod.create({
      data: { ...data, tenant_id: context.tenantId },
      include: { rows: true },
    });
  }
}
