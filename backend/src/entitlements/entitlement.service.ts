import { Injectable } from '@nestjs/common';
import type { Plan, Subscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { AccessMode, EntitlementAccess, PlanLimits } from './entitlement.types';

const DAY_MS = 24 * 60 * 60 * 1000;

type SubscriptionRow = Subscription & { plan: Plan };

export function graceDays(): number {
  const days = Number(process.env.ENTITLEMENT_GRACE_DAYS ?? 7);
  return Number.isFinite(days) && days >= 0 ? days : 7;
}

function cacheTtlMs(): number {
  const ms = Number(process.env.ENTITLEMENT_CACHE_TTL_MS ?? 30_000);
  return Number.isFinite(ms) && ms >= 0 ? ms : 30_000;
}

/** Keeps only well-formed limit values; anything else means "unlimited". */
function parseLimits(json: unknown): PlanLimits {
  const limits: Record<string, number | null> = {};
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    for (const [key, value] of Object.entries(json)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) limits[key] = value;
    }
  }
  return limits;
}

const NO_SUBSCRIPTION: EntitlementAccess = {
  mode: 'suspended',
  planCode: null,
  planName: null,
  features: new Set(),
  limits: {},
  status: null,
  trialEndsAt: null,
  periodEnd: null,
  graceUntil: null,
  restrictedSince: null,
  snapshotVersion: 0,
};

/**
 * The mode rules, as a pure function of the subscription and the clock:
 * - suspended/cancelled                → suspended
 * - expired                            → read_only
 * - trial/active up to the period end  → full (no end date = no expiry)
 * - up to `graceDays` after the end    → grace (full access, with a warning)
 * - after that                         → read_only
 */
export function computeAccess(
  row: SubscriptionRow | null,
  now: Date,
  graceDaysAfterEnd: number,
): EntitlementAccess {
  if (!row) return NO_SUBSCRIPTION;

  const periodEnd = row.status === 'trial' ? row.trial_ends_at : row.current_period_end;
  const base = {
    planCode: row.plan.code,
    planName: { ar: row.plan.name_ar, en: row.plan.name_en },
    features: new Set(row.plan.features),
    limits: parseLimits(row.plan.limits),
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    periodEnd,
    graceUntil: null,
    restrictedSince: null,
    snapshotVersion: Math.max(row.updated_at.getTime(), row.plan.updated_at.getTime()),
  };
  const restricted = (mode: AccessMode, since: Date): EntitlementAccess =>
    ({ ...base, mode, restrictedSince: since });

  if (row.status === 'suspended' || row.status === 'cancelled') {
    return restricted('suspended', row.status_changed_at);
  }
  if (row.status === 'expired') return restricted('read_only', row.status_changed_at);
  if (!periodEnd || now <= periodEnd) return { ...base, mode: 'full' };

  const graceUntil = new Date(periodEnd.getTime() + graceDaysAfterEnd * DAY_MS);
  if (now <= graceUntil) return { ...base, mode: 'grace', graceUntil };
  return restricted('read_only', graceUntil);
}

/**
 * Resolves what a tenant's plan currently allows (ADR-0005 "Entitlement").
 *
 * The subscription and its plan are cached briefly per tenant; the mode is
 * computed from the clock on every call, so a period ending is noticed at once.
 * Every change made through this process calls `invalidate`; other processes
 * see it after the TTL.
 */
@Injectable()
export class EntitlementService {
  private readonly cache = new Map<string, { expiresAt: number; row: SubscriptionRow | null }>();

  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, now = new Date()): Promise<EntitlementAccess> {
    return computeAccess(await this.load(tenantId), now, graceDays());
  }

  /** Drops one tenant's cached subscription, or everything (a plan edit affects many tenants). */
  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  /**
   * For writes that do not pass through the tenant guard (device-authenticated
   * POS calls). `occurredAt` is when a completed offline operation really
   * happened: a sale rung up before the restriction began is still accepted,
   * because a completed sale is never lost.
   */
  async assertCanWrite(tenantId: string, occurredAt?: Date): Promise<void> {
    const access = await this.resolve(tenantId);
    if (access.mode === 'full' || access.mode === 'grace') return;
    if (occurredAt && access.restrictedSince && occurredAt < access.restrictedSince) return;
    throw restrictedError(access.mode);
  }

  private async load(tenantId: string): Promise<SubscriptionRow | null> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.row;
    const row = await this.prisma.subscription.findUnique({
      where: { tenant_id: tenantId },
      include: { plan: true },
    });
    this.cache.set(tenantId, { expiresAt: Date.now() + cacheTtlMs(), row });
    return row;
  }
}

export function restrictedError(mode: AccessMode): AthrDomainError {
  if (mode === 'read_only') {
    return new AthrDomainError(
      'TENANT_READ_ONLY',
      'Your subscription has ended. The account is read-only until it is renewed.',
      undefined,
      { messageAr: 'انتهى اشتراكك. الحساب للقراءة فقط حتى يتم التجديد.' },
    );
  }
  return new AthrDomainError(
    'TENANT_SUSPENDED',
    'This account is suspended. Contact support to reactivate it.',
    undefined,
    { messageAr: 'هذا الحساب موقوف. تواصل مع الدعم لإعادة تفعيله.' },
  );
}

export function featureNotInPlanError(feature: string, planCode: string | null): AthrDomainError {
  return new AthrDomainError(
    'ENTITLEMENT_FEATURE_NOT_IN_PLAN',
    `Your plan does not include this feature (${feature}). Upgrade your plan to use it.`,
    undefined,
    {
      messageAr: `باقتك الحالية لا تشمل هذه الميزة (${feature}). قم بترقية الباقة لاستخدامها.`,
      data: { feature, plan_code: planCode },
    },
  );
}
