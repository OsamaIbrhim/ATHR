import type { Prisma, PrismaClient } from '@prisma/client';

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
    description: '1 branch, 2 POS terminals, 3 users, unlimited products.',
    price_monthly: 449,
    limits: { branches: 1, terminals: 2, users: 3 },
    features: ['uom'],
    is_public: true,
    sort_order: 1,
  },
  {
    code: 'pro',
    name_ar: 'الاحترافي',
    name_en: 'Pro',
    description: 'Up to 3 branches, 6 POS terminals, 10 users, unlimited products.',
    price_monthly: 999,
    limits: { branches: 3, terminals: 6, users: 10 },
    features: ['uom', 'receipt.remove_branding'],
    is_public: true,
    sort_order: 2,
  },
  {
    // Offered on request (more than 3 branches); not on the public pricing page.
    code: 'business',
    name_ar: 'الأعمال',
    name_en: 'Business',
    description: 'Up to 10 branches, 30 POS terminals, 30 users.',
    price_monthly: 1999,
    limits: { branches: 10, terminals: 30, users: 30 },
    features: ['uom', 'receipt.remove_branding'],
    is_public: false,
    sort_order: 3,
  },
  // Features are listed explicitly per plan: a key added to the catalog later
  // (or one whose screens are not built yet: promotions, tracking.*, api.access)
  // must never reach a plan by accident. See docs/strategy/pricing.md.
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
