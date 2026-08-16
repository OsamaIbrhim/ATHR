import { randomUUID } from 'crypto';
import { PromotionEvaluationService } from './promotion-evaluation.service';
import { PromotionRepository } from './promotion.repository';
import { CouponRepository } from './coupon.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

/**
 * WP-008 Phase D — BR-CERR-202: "Promotion evaluation failure لا تخفي السعر
 * الأساسي" (a promotion-engine failure must never hide the base price).
 * Task brief D.4 item 6: "test this as failure injection, not as a happy
 * path — this is the item most likely to be quietly skipped."
 *
 * Every scenario below makes a DEPENDENCY of `evaluate()` throw (Prisma, the
 * promotion repository, the coupon repository) and asserts the same
 * contract: no exception escapes, `applied` is `null`, and
 * `evaluationFailed` is `true` — the caller (`PricingController.calculate`)
 * always still has the base `quote` it computed before calling this service,
 * so a sale is never blocked or mispriced by an engine fault.
 */

const ACTOR_LINE = {
  variantId: randomUUID(),
  qty: 1,
  unitNetPrice: 100,
  taxRateSnapshot: 14,
  taxModeSnapshot: 'exclusive' as const,
};

function serviceWithFailingPrisma() {
  const prisma = {
    productVariant: {
      findFirst: jest.fn().mockRejectedValue(new Error('connection reset')),
    },
  } as any;
  const promotions = { listActiveForEvaluation: jest.fn() } as unknown as PromotionRepository;
  const coupons = {} as CouponRepository;
  return new PromotionEvaluationService(prisma, promotions, coupons);
}

function serviceWithFailingPromotionLookup() {
  const prisma = {
    productVariant: {
      findFirst: jest.fn().mockResolvedValue({
        id: ACTOR_LINE.variantId,
        product_id: randomUUID(),
        product: { brand_id: null, category_id: null },
      }),
    },
  } as any;
  const promotions = {
    listActiveForEvaluation: jest.fn().mockRejectedValue(new Error('promotion table unavailable')),
  } as unknown as PromotionRepository;
  const coupons = {} as CouponRepository;
  return new PromotionEvaluationService(prisma, promotions, coupons);
}

function serviceWithMalformedPromotion() {
  const prisma = {
    productVariant: {
      findFirst: jest.fn().mockResolvedValue({
        id: ACTOR_LINE.variantId,
        product_id: randomUUID(),
        product: { brand_id: null, category_id: null },
      }),
    },
  } as any;
  const promotions = {
    // scope_type is an invalid/unrecognised value — a corrupt row, not a
    // shape TypeScript would let application code construct.
    listActiveForEvaluation: jest.fn().mockResolvedValue([
      {
        id: randomUUID(),
        name: 'Corrupt',
        // Eligible on every ordinary condition, so evaluation reaches
        // benefit calculation — where the poisoned `benefit_value` below
        // throws. A genuinely mismatched scope_type would just be excluded
        // by `scopeMatches`'s default branch, which is correct behaviour,
        // not a failure to inject.
        scope_type: 'all',
        min_qty: null,
        min_spend: null,
        branch_id: null,
        customer_id: null,
        requires_coupon: false,
        benefit_type: 'percentage',
        benefit_value: { toString: () => { throw new Error('poisoned Decimal'); } },
        max_units_per_order: null,
        max_discount_amount: null,
      },
    ]),
  } as unknown as PromotionRepository;
  const coupons = {} as CouponRepository;
  return new PromotionEvaluationService(prisma, promotions, coupons);
}

describe('PromotionEvaluationService — BR-CERR-202 failure injection', () => {
  it('never throws when the variant lookup itself fails', async () => {
    const service = serviceWithFailingPrisma();
    const result = await service.evaluate(contextFor(TENANT_A), ACTOR_LINE);
    expect(result.evaluationFailed).toBe(true);
    expect(result.applied).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  it('never throws when loading active promotions fails', async () => {
    const service = serviceWithFailingPromotionLookup();
    const result = await service.evaluate(contextFor(TENANT_A), ACTOR_LINE);
    expect(result.evaluationFailed).toBe(true);
    expect(result.applied).toBeNull();
  });

  it('never throws on a malformed/corrupt promotion row during benefit calculation', async () => {
    const service = serviceWithMalformedPromotion();
    const result = await service.evaluate(contextFor(TENANT_A), ACTOR_LINE);
    expect(result.evaluationFailed).toBe(true);
    expect(result.applied).toBeNull();
  });

  it('returns no discount (not a failure) when the variant does not resolve — a legitimate empty result', async () => {
    const prisma = { productVariant: { findFirst: jest.fn().mockResolvedValue(null) } } as any;
    const service = new PromotionEvaluationService(
      prisma,
      {} as PromotionRepository,
      {} as CouponRepository,
    );
    const result = await service.evaluate(contextFor(TENANT_A), ACTOR_LINE);
    expect(result.evaluationFailed).toBe(false);
    expect(result.applied).toBeNull();
  });
});
