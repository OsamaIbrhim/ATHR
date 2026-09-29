import { Injectable } from '@nestjs/common';
import type { Prisma, SellerCommissionSettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { primaryBranchId, toScopeSet } from '../auth/branch-access';
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

  /** Sellers are the tenant's `seller` Memberships; branch comes from their location scope. */
  async listSellers(context: TenantScope, branchId?: string, sellerId?: string) {
    const memberships = await this.prisma.membership.findMany({
      where: {
        tenant_id: context.tenantId,
        role: 'seller',
        ...(sellerId ? { user_id: sellerId } : {}),
        ...(branchId
          ? { access_scope_assignments: { some: { scope_type: 'location', scope_ref_id: branchId } } }
          : {}),
      },
      select: {
        access_scope_assignments: true,
        user: { select: { id: true, name: true, is_active: true, seller_commission_override: true } },
      },
      orderBy: [{ user: { name: 'asc' } }, { user_id: 'asc' }],
    });
    const branchOf = (scopes: (typeof memberships)[number]['access_scope_assignments']) =>
      primaryBranchId({ scope_set: toScopeSet(scopes) });
    const branchIds = [
      ...new Set(memberships.map((m) => branchOf(m.access_scope_assignments)).filter((id): id is string => !!id)),
    ];
    const branches = branchIds.length
      ? await this.prisma.branch.findMany({
          where: { id: { in: branchIds }, tenant_id: context.tenantId },
          select: { id: true, code: true, name_ar: true },
        })
      : [];
    return memberships.map(({ user, access_scope_assignments }) => {
      const branch_id = branchOf(access_scope_assignments);
      return { ...user, branch_id, branch: branches.find((b) => b.id === branch_id) ?? null };
    });
  }

  async findSeller(context: TenantScope, sellerId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { user_id: sellerId, role: 'seller', tenant_id: context.tenantId },
      select: { user_id: true },
    });
    return membership && { id: membership.user_id };
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

  /** One settings row per tenant (its primary key); created with the defaults on first use. */
  async getSettings(context: TenantScope): Promise<SellerCommissionSettings> {
    return this.prisma.sellerCommissionSettings.upsert({
      where: { tenant_id: context.tenantId },
      update: {},
      create: { tenant_id: context.tenantId },
    });
  }

  async updateSettings(
    context: TenantScope,
    data: Omit<Prisma.SellerCommissionSettingsUncheckedUpdateInput, 'tenant_id'>,
  ) {
    return this.prisma.sellerCommissionSettings.upsert({
      where: { tenant_id: context.tenantId },
      update: data,
      create: { ...(data as Prisma.SellerCommissionSettingsUncheckedCreateInput), tenant_id: context.tenantId },
    });
  }

  async listOverrides(context: TenantScope, branchId?: string) {
    return this.prisma.sellerCommissionOverride.findMany({
      where: {
        tenant_id: context.tenantId,
        seller: {
          memberships: {
            some: {
              tenant_id: context.tenantId,
              ...(branchId
                ? { access_scope_assignments: { some: { scope_type: 'location' as const, scope_ref_id: branchId } } }
                : {}),
            },
          },
        },
      },
      include: { seller: { select: { id: true, name: true } } },
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
