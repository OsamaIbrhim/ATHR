import { randomUUID } from 'crypto';
import { PromotionRepository } from './promotion.repository';
import { PromotionService } from './promotion.service';
import { CouponRepository } from './coupon.repository';
import { BundleRepository } from './bundle.repository';
import { BundleService } from './bundle.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-008 Phase D — cross-tenant isolation for every table this phase adds:
 * `Promotion`, `Coupon`, `Bundle`, `BundleComponent` (Multi-tenancy Blueprint
 * §32, same pattern Phases A-C established).
 *
 * `CouponRedemption` and `CouponRepository.redeem`'s success path are
 * deliberately NOT exercised here: `fakePrisma`'s `$executeRaw` always
 * returns `0` (a stub — see `cross-tenant-harness.ts`), which is exactly the
 * "capacity exhausted" branch of `redeem()`'s atomic claim, so any spec
 * built on it would either always see a false `COUPON_USAGE_LIMIT_EXCEEDED`
 * or would need to mock around the very statement being proven. That
 * statement, and the unique-constraint-backed idempotency it depends on, are
 * proven only against real Postgres — see `verify-promotion-behaviour.cjs`.
 * Hand-seeded fixtures are used directly in this file rather than adding a
 * `fixture-builders.ts` surface for these three models (same allowed
 * precedent `priceBook`/`priceBookEntry` already use) — a deliberate choice,
 * not an oversight.
 */

const PROMOTION_A = randomUUID();
const PROMOTION_B = randomUUID();
const COUPON_A = randomUUID();
const COUPON_B = randomUUID();
const BUNDLE_A = randomUUID();
const BUNDLE_B = randomUUID();
const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();
const ACTOR = randomUUID();

function basePromotion(overrides: Record<string, unknown>) {
  return {
    name: 'Promo',
    status: 'draft',
    timezone: 'Africa/Cairo',
    starts_at: new Date(),
    ends_at: null,
    priority: 100,
    stackability: 'exclusive',
    benefit_type: 'percentage',
    benefit_value: 10,
    scope_type: 'all',
    requires_coupon: false,
    return_policy: null,
    created_at: new Date(),
    ...overrides,
  };
}

function setup() {
  const prisma = fakePrisma({
    promotion: [
      basePromotion({ id: PROMOTION_A, tenant_id: TENANT_A }),
      basePromotion({ id: PROMOTION_B, tenant_id: TENANT_B }),
    ],
    coupon: [
      {
        id: COUPON_A,
        tenant_id: TENANT_A,
        promotion_id: PROMOTION_A,
        code_normalized: 'CODEA',
        code_display: 'CodeA',
        type: 'public',
        status: 'active',
        use_count: 0,
        created_at: new Date(),
      },
      {
        id: COUPON_B,
        tenant_id: TENANT_B,
        promotion_id: PROMOTION_B,
        code_normalized: 'CODEB',
        code_display: 'CodeB',
        type: 'public',
        status: 'active',
        use_count: 0,
        created_at: new Date(),
      },
    ],
    couponRedemption: [],
    bundle: [
      {
        id: BUNDLE_A,
        tenant_id: TENANT_A,
        name: 'Bundle A',
        status: 'draft',
        allocation_method: 'proportional_price',
        return_policy: null,
        version: 1,
        created_at: new Date(),
      },
      {
        id: BUNDLE_B,
        tenant_id: TENANT_B,
        name: 'Bundle B',
        status: 'draft',
        allocation_method: 'proportional_price',
        return_policy: null,
        version: 1,
        created_at: new Date(),
      },
    ],
    bundleComponent: [
      { id: randomUUID(), tenant_id: TENANT_A, bundle_id: BUNDLE_A, variant_id: VARIANT_A, qty: 1, created_at: new Date() },
      { id: randomUUID(), tenant_id: TENANT_B, bundle_id: BUNDLE_B, variant_id: VARIANT_B, qty: 1, created_at: new Date() },
    ],
  });

  const promotionRepository = new PromotionRepository(prisma);
  const bundleRepository = new BundleRepository(prisma);
  return {
    prisma,
    promotions: new PromotionService(promotionRepository),
    coupons: new CouponRepository(prisma),
    bundles: new BundleService(bundleRepository),
  };
}

describe('Promotion — cross-tenant isolation', () => {
  it("lists only the calling tenant's promotions", async () => {
    const { promotions } = setup();
    expect((await promotions.list(contextFor(TENANT_A))).items.map((r) => r.id)).toEqual([PROMOTION_A]);
    expect((await promotions.list(contextFor(TENANT_B))).items.map((r) => r.id)).toEqual([PROMOTION_B]);
  });

  it("does not resolve another tenant's promotion by id", async () => {
    const { promotions } = setup();
    await expect(promotions.findOne(contextFor(TENANT_B), PROMOTION_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it("cannot transition another tenant's promotion", async () => {
    const { promotions } = setup();
    await expect(promotions.submit(contextFor(TENANT_B), ACTOR, PROMOTION_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('stamps a newly created promotion with the CALLING tenant', async () => {
    const { promotions } = setup();
    const created = await promotions.create(contextFor(TENANT_B), ACTOR, {
      name: 'New',
      starts_at: new Date().toISOString(),
      benefit_type: 'fixed_amount',
      benefit_value: 5,
    } as any);
    expect(created.tenant_id).toBe(TENANT_B);
  });
});

describe('Coupon — cross-tenant isolation', () => {
  it("does not resolve another tenant's coupon by id", async () => {
    const { coupons } = setup();
    expect(await coupons.findById(contextFor(TENANT_B), COUPON_A)).toBeNull();
  });

  it("does not resolve another tenant's coupon by code, even with the correct code string", async () => {
    // The sharp case: if lookup keyed on code alone, tenant B could redeem
    // tenant A's coupon.
    const { coupons } = setup();
    expect(await coupons.findByCode(contextFor(TENANT_B), 'CodeA')).toBeNull();
  });

  it("lists only the calling tenant's coupons", async () => {
    const { coupons } = setup();
    expect((await coupons.list(contextFor(TENANT_A))).rows.map((r) => r.id)).toEqual([COUPON_A]);
  });
});

describe('Bundle — cross-tenant isolation', () => {
  it("lists only the calling tenant's bundles", async () => {
    const { bundles } = setup();
    expect((await bundles.list(contextFor(TENANT_A))).items.map((r) => r.id)).toEqual([BUNDLE_A]);
  });

  it("does not resolve another tenant's bundle by id", async () => {
    const { bundles } = setup();
    await expect(bundles.findOne(contextFor(TENANT_B), BUNDLE_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it("a bundle's components never leak another tenant's variant ids into scope", async () => {
    const { bundles } = setup();
    const bundleA = await bundles.findOne(contextFor(TENANT_A), BUNDLE_A);
    expect(bundleA.components.every((c) => c.tenant_id === TENANT_A)).toBe(true);
    expect(bundleA.components.some((c) => c.variant_id === VARIANT_B)).toBe(false);
  });

  it("cannot activate another tenant's bundle", async () => {
    const { bundles } = setup();
    await expect(bundles.activate(contextFor(TENANT_B), ACTOR, BUNDLE_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});
