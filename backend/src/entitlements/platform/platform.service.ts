import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Plan, type Subscription } from '@prisma/client';
import { AthrDomainError } from '../../common/http/athr-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { CATALOG, FEATURE_KEYS, LIMITS, LIMIT_KEYS } from '../catalog';
import { EntitlementService, computeAccess, graceDays } from '../entitlement.service';
import { LimitService } from '../limit.service';
import { toPlanView } from '../plan-view';
import type { CreatePlanDto, ExtendDto, ListTenantsDto, UpdatePlanDto } from './platform.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

type SubscriptionRow = Subscription & { plan: Plan };

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** Unknown feature/limit keys are rejected so a typo never silently disables a feature. */
function assertKnownKeys(features?: string[], limits?: Record<string, number | null>) {
  const unknownFeatures = (features ?? []).filter((key) => !FEATURE_KEYS.includes(key));
  const unknownLimits = Object.keys(limits ?? {}).filter((key) => !LIMIT_KEYS.includes(key));
  if (unknownFeatures.length || unknownLimits.length) {
    throw new BadRequestException(
      `Unknown catalog keys: ${[...unknownFeatures, ...unknownLimits].join(', ')}`,
    );
  }
  for (const [key, value] of Object.entries(limits ?? {})) {
    if (value !== null && !(Number.isInteger(value) && value >= 0)) {
      throw new BadRequestException(`Limit "${key}" must be a non-negative integer or null (unlimited).`);
    }
  }
}

/** The platform owner's console: tenants, their subscriptions and the plans. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly limits: LimitService,
  ) {}

  // ---- Tenants and subscriptions -------------------------------------------------

  async listTenants(query: ListTenantsDto) {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 25;
    const where: Prisma.TenantWhereInput = query.search
      ? { name: { contains: query.search, mode: 'insensitive' } }
      : {};
    const [total, tenants] = await Promise.all([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { subscription: { include: { plan: true } } },
      }),
    ]);
    const usage = await this.usageFor(tenants.map((tenant) => tenant.id));
    return {
      total,
      page,
      page_size: pageSize,
      items: tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        created_at: tenant.created_at,
        subscription: this.subscriptionView(tenant.subscription),
        usage: usage.get(tenant.id),
      })),
    };
  }

  async getTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscription: { include: { plan: true } },
        organization_profile: true,
        subscription_events: { orderBy: { created_at: 'desc' }, take: 50 },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      id: tenant.id,
      name: tenant.name,
      business_type: tenant.organization_profile?.business_type ?? null,
      created_at: tenant.created_at,
      subscription: this.subscriptionView(tenant.subscription),
      usage: await this.limits.usage(tenant.id),
      events: tenant.subscription_events,
    };
  }

  async changePlan(tenantId: string, planCode: string, actorId: string, note?: string) {
    const plan = await this.prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.is_active) throw new BadRequestException(`Plan "${planCode}" is not available.`);
    return this.mutate(tenantId, actorId, 'plan_changed', note, () => ({ plan_id: plan.id }));
  }

  async setStatus(tenantId: string, status: Subscription['status'], actorId: string, note?: string) {
    return this.mutate(tenantId, actorId, 'status_changed', note, (current, now) => {
      // An active/trial subscription with no end date would never expire: make the owner say when.
      const end = status === 'trial' ? current.trial_ends_at : current.current_period_end;
      if ((status === 'active' || status === 'trial') && !end) {
        throw new BadRequestException(`Set the ${status === 'trial' ? 'trial' : 'period'} end first (extend), then activate.`);
      }
      return { status, ...(status !== current.status ? { status_changed_at: now } : {}) };
    });
  }

  /** Adds days/months to the current end (a trial's end while on trial), counting from now if it already passed. */
  async extend(tenantId: string, dto: ExtendDto, actorId: string) {
    if (!dto.days && !dto.months) throw new BadRequestException('Provide days or months to extend by.');
    return this.mutate(tenantId, actorId, 'extended', dto.note, (current, now) => {
      const field = current.status === 'trial' ? 'trial_ends_at' : 'current_period_end';
      const currentEnd = current[field];
      const base = currentEnd && currentEnd > now ? currentEnd : now;
      const end = new Date(addMonths(base, dto.months ?? 0).getTime() + (dto.days ?? 0) * DAY_MS);
      return { [field]: end };
    });
  }

  async addNote(tenantId: string, note: string, actorId: string) {
    return this.mutate(tenantId, actorId, 'note', note, () => ({ notes: note }));
  }

  /**
   * One place every subscription change goes through: update + audit event in a
   * transaction, then drop the cached entitlement so it applies at once.
   */
  private async mutate(
    tenantId: string,
    actorId: string,
    action: string,
    note: string | undefined,
    change: (current: SubscriptionRow, now: Date) => Prisma.SubscriptionUncheckedUpdateInput,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.subscription.findUnique({ where: { tenant_id: tenantId }, include: { plan: true } });
      if (!current) throw new NotFoundException('Tenant has no subscription');
      const subscription = await tx.subscription.update({
        where: { tenant_id: tenantId },
        data: { ...change(current, new Date()), updated_by: actorId },
        include: { plan: true },
      });
      const endOf = (row: SubscriptionRow) => (row.status === 'trial' ? row.trial_ends_at : row.current_period_end);
      await tx.subscriptionEvent.create({
        data: {
          tenant_id: tenantId,
          action,
          from_plan_code: current.plan.code,
          to_plan_code: subscription.plan.code,
          from_status: current.status,
          to_status: subscription.status,
          from_period_end: endOf(current),
          to_period_end: endOf(subscription),
          actor_user_id: actorId,
          note: note ?? null,
        },
      });
      return subscription;
    });
    this.entitlements.invalidate(tenantId);
    return this.subscriptionView(updated);
  }

  private subscriptionView(row: SubscriptionRow | null) {
    if (!row) return null;
    const access = computeAccess(row, new Date(), graceDays());
    return {
      plan_code: row.plan.code,
      status: row.status,
      mode: access.mode,
      trial_ends_at: row.trial_ends_at,
      current_period_end: row.current_period_end,
      grace_until: access.graceUntil,
      notes: row.notes,
      updated_at: row.updated_at,
    };
  }

  /** Usage counts for a page of tenants: one grouped query per resource. */
  private async usageFor(tenantIds: string[]) {
    const inPage = { tenant_id: { in: tenantIds } };
    const [branches, terminals, users, products] = await Promise.all([
      this.prisma.branch.groupBy({ by: ['tenant_id'], where: { ...inPage, is_active: true }, _count: { _all: true } }),
      this.prisma.posTerminal.groupBy({ by: ['tenant_id'], where: { ...inPage, is_revoked: false }, _count: { _all: true } }),
      this.prisma.membership.groupBy({
        by: ['tenant_id'],
        where: { ...inPage, status: { notIn: ['deactivated', 'expired'] } },
        _count: { _all: true },
      }),
      this.prisma.product.groupBy({ by: ['tenant_id'], where: { ...inPage, is_active: true }, _count: { _all: true } }),
    ]);
    const byResource = { branches, terminals, users, products };
    const usage = new Map<string, Record<string, number>>();
    for (const tenantId of tenantIds) {
      usage.set(
        tenantId,
        Object.fromEntries(
          LIMITS.map(({ key }) => [key, byResource[key].find((row) => row.tenant_id === tenantId)?._count._all ?? 0]),
        ),
      );
    }
    return usage;
  }

  // ---- Plans ---------------------------------------------------------------------

  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      orderBy: [{ sort_order: 'asc' }, { price_monthly: 'asc' }],
      include: { _count: { select: { subscriptions: true } } },
    });
    return {
      plans: plans.map((plan) => ({ ...toPlanView(plan), subscriptions: plan._count.subscriptions })),
      catalog: CATALOG,
    };
  }

  async createPlan(dto: CreatePlanDto) {
    assertKnownKeys(dto.features, dto.limits);
    const plan = await this.prisma.plan.create({ data: { ...dto, limits: dto.limits } });
    return toPlanView(plan);
  }

  /** Edits apply to every subscriber straight away (after the cache is dropped); no data is touched. */
  async updatePlan(id: string, dto: UpdatePlanDto) {
    assertKnownKeys(dto.features, dto.limits);
    const exists = await this.prisma.plan.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Plan not found');
    const plan = await this.prisma.plan.update({ where: { id }, data: dto });
    this.entitlements.invalidate();
    return toPlanView(plan);
  }

  /** A plan with subscribers can only be deactivated (`is_active: false`), never deleted. */
  async deletePlan(id: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan._count.subscriptions > 0) {
      throw new AthrDomainError(
        'PLAN_IN_USE',
        `Plan "${plan.code}" is used by ${plan._count.subscriptions} subscription(s). Deactivate it instead of deleting it.`,
        undefined,
        { messageAr: 'الباقة مستخدمة في اشتراكات قائمة. قم بإيقافها بدلاً من حذفها.' },
      );
    }
    await this.prisma.plan.delete({ where: { id } });
    return { deleted: true };
  }
}
