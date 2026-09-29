import type { Prisma, PrismaClient } from '@prisma/client';
import { FEATURE_KEYS } from '../../src/entitlements/catalog';

/**
 * The initial plans. This is only the starting point: once seeded, the platform
 * owner edits prices, limits and features from the console, and re-running the
 * seed never overwrites those edits (it only creates plans that are missing).
 * A limit that is absent means unlimited.
 */
export const INITIAL_PLANS = [
  {
    code: 'starter',
    name_ar: 'المبتدئ',
    name_en: 'Starter',
    description: '1 branch, 2 POS terminals, 3 users.',
    price_monthly: 499,
    limits: { branches: 1, terminals: 2, users: 3 },
    features: [],
    sort_order: 1,
  },
  {
    code: 'pro',
    name_ar: 'الاحترافي',
    name_en: 'Pro',
    description: '3 branches, 6 POS terminals, promotions and units of measure.',
    price_monthly: 1299,
    limits: { branches: 3, terminals: 6 },
    features: ['promotions', 'uom'],
    sort_order: 2,
  },
  {
    code: 'business',
    name_ar: 'الأعمال',
    name_en: 'Business',
    description: 'Unlimited, with serial/batch tracking and API access.',
    price_monthly: 2999,
    limits: {},
    features: [...FEATURE_KEYS],
    sort_order: 3,
  },
] as const;

/** Idempotent: creates the plans that do not exist yet and leaves existing ones as the owner edited them. */
export async function seedPlans(prisma: PrismaClient | Prisma.TransactionClient) {
  for (const plan of INITIAL_PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      create: { ...plan, features: [...plan.features] },
      update: {},
    });
  }
}

/** Gives a tenant an active subscription on `planCode` for a year, unless it already has one. */
export async function ensureActiveSubscription(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  planCode: string,
) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: planCode } });
  const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await prisma.subscription.upsert({
    where: { tenant_id: tenantId },
    create: { tenant_id: tenantId, plan_id: plan.id, status: 'active', current_period_end: periodEnd },
    update: {},
  });
}
