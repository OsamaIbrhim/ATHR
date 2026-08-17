import { randomUUID } from 'crypto';
import { PromotionEvaluationService } from './promotion-evaluation.service';
import type { PromotionRepository } from './promotion.repository';
import type { CouponRepository } from './coupon.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

/**
 * WP-008 Phase D — `PromotionEvaluationService`'s BR-BEN-1xx benefit
 * calculation and BR-CND-1xx eligibility, happy-path correctness (the
 * failure-INJECTION half lives in `promotion-evaluation.failure-injection.
 * spec.ts`, per BR-CERR-202). `PrismaService`/`PromotionRepository`/
 * `CouponRepository` are hand-mocked — this exercises the pure evaluation
 * logic, not database behaviour.
 */

const VARIANT_ID = randomUUID();
const PRODUCT_ID = randomUUID();

function basePromotion(overrides: Record<string, unknown>) {
  return {
    id: randomUUID(),
    name: 'Promo',
    priority: 100,
    scope_type: 'all',
    scope_id: null,
    min_qty: null,
    min_spend: null,
    branch_id: null,
    customer_id: null,
    requires_coupon: false,
    benefit_type: 'percentage',
    benefit_value: 10,
    bogo_buy_qty: null,
    bogo_get_qty: null,
    bogo_get_discount_percent: null,
    max_discount_amount: null,
    max_units_per_order: null,
    ...overrides,
  };
}

function serviceWith(promotions: unknown[], couponsStub: Partial<CouponRepository> = {}) {
  const prisma = {
    productVariant: {
      findFirst: jest.fn().mockResolvedValue({
        id: VARIANT_ID,
        product_id: PRODUCT_ID,
        product: { brand_id: null, category_id: null },
      }),
    },
  } as any;
  const promotionRepo = {
    listActiveForEvaluation: jest.fn().mockResolvedValue(promotions),
  } as unknown as PromotionRepository;
  const couponRepo = couponsStub as CouponRepository;
  return new PromotionEvaluationService(prisma, promotionRepo, couponRepo);
}

const LINE = (overrides: Record<string, unknown> = {}) => ({
  variantId: VARIANT_ID,
  qty: 4,
  unitNetPrice: 100,
  taxRateSnapshot: 14,
  taxModeSnapshot: 'exclusive' as const,
  ...overrides,
});

describe('PromotionEvaluationService — benefit calculation', () => {
  it('percentage: discounts every unit up to max_units_per_order', async () => {
    const service = serviceWith([basePromotion({ benefit_type: 'percentage', benefit_value: 10 })]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ qty: 4, unitNetPrice: 100 }));
    expect(result.applied?.discount_amount).toBeCloseTo(40, 2); // 4 * 100 * 10%
    expect(result.applied?.discounted_units).toBe(4);
  });

  it('fixed_amount: a flat amount off each qualifying unit', async () => {
    const service = serviceWith([basePromotion({ benefit_type: 'fixed_amount', benefit_value: 5 })]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ qty: 3 }));
    expect(result.applied?.discount_amount).toBeCloseTo(15, 2);
  });

  it('fixed_price: never produces a negative discount when the target exceeds the unit price', async () => {
    const service = serviceWith([basePromotion({ benefit_type: 'fixed_price', benefit_value: 500 })]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ unitNetPrice: 100 }));
    expect(result.applied).toBeNull();
  });

  it('fixed_price: discounts down to the target unit price', async () => {
    const service = serviceWith([basePromotion({ benefit_type: 'fixed_price', benefit_value: 80 })]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ qty: 2, unitNetPrice: 100 }));
    expect(result.applied?.discount_amount).toBeCloseTo(40, 2); // (100-80) * 2
  });

  it('BR-BEN-104: bogo discounts complete (buy+get) groups only, never a partial group', async () => {
    const service = serviceWith([
      basePromotion({ benefit_type: 'bogo', bogo_buy_qty: 2, bogo_get_qty: 1, bogo_get_discount_percent: 100 }),
    ]);
    // qty=7 -> groups of 3 (buy2get1) = 2 complete groups (6 units), 1 leftover unit ignored.
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ qty: 7, unitNetPrice: 100 }));
    expect(result.applied?.discounted_units).toBe(2);
    expect(result.applied?.discount_amount).toBeCloseTo(200, 2); // 2 free units * 100
  });

  it('bogo: fewer than one complete group yields no discount', async () => {
    const service = serviceWith([
      basePromotion({ benefit_type: 'bogo', bogo_buy_qty: 2, bogo_get_qty: 1, bogo_get_discount_percent: 100 }),
    ]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ qty: 2 }));
    expect(result.applied).toBeNull();
  });

  it('BR-BEN-105: max_discount_amount caps the benefit regardless of the raw calculation', async () => {
    const service = serviceWith([
      basePromotion({ benefit_type: 'percentage', benefit_value: 50, max_discount_amount: 10 }),
    ]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ qty: 4, unitNetPrice: 100 }));
    expect(result.applied?.discount_amount).toBe(10);
  });

  it('recomputes tax on the discounted price using the SAME rate/mode the base quote already resolved', async () => {
    const service = serviceWith([basePromotion({ benefit_type: 'percentage', benefit_value: 10 })]);
    const result = await service.evaluate(
      contextFor(TENANT_A),
      LINE({ qty: 1, unitNetPrice: 100, taxRateSnapshot: 14, taxModeSnapshot: 'exclusive' }),
    );
    // net 90 -> tax 90*14% = 12.6 -> gross 102.6
    expect(result.applied?.effective_unit_net_price).toBeCloseTo(90, 2);
    expect(result.applied?.effective_tax_amount).toBeCloseTo(12.6, 2);
    expect(result.applied?.effective_selling_price).toBeCloseTo(102.6, 2);
  });
});

describe('PromotionEvaluationService — eligibility (BR-CND-1xx)', () => {
  it('scope_type=variant only matches the exact variant', async () => {
    const service = serviceWith([basePromotion({ scope_type: 'variant', scope_id: randomUUID() })]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE());
    expect(result.applied).toBeNull();
    expect(result.candidates[0].reason).toBe('scope_mismatch');
  });

  it('min_qty excludes a line that does not meet it', async () => {
    const service = serviceWith([basePromotion({ min_qty: 10 })]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ qty: 3 }));
    expect(result.candidates[0].reason).toBe('min_qty_not_met');
  });

  it('BR-CND-102: a promotion with min_spend is excluded, not silently ignored or assumed satisfied', async () => {
    const service = serviceWith([basePromotion({ min_spend: 200 })]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE());
    expect(result.applied).toBeNull();
    expect(result.candidates[0].reason).toBe('min_spend_requires_cart_context');
  });

  it('requires_coupon: excluded when no coupon_code is supplied', async () => {
    const service = serviceWith([basePromotion({ requires_coupon: true })]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ couponCode: null }));
    expect(result.candidates[0].reason).toBe('requires_coupon');
  });

  it('requires_coupon: eligible once a valid matching coupon is supplied', async () => {
    const promotion = basePromotion({ requires_coupon: true });
    const couponId = randomUUID();
    const service = serviceWith([promotion], {
      findByCode: jest.fn().mockResolvedValue({
        id: couponId,
        promotion_id: promotion.id,
        status: 'active',
        expires_at: null,
        type: 'public',
        customer_id: null,
      }),
    });
    const result = await service.evaluate(contextFor(TENANT_A), LINE({ couponCode: 'WELCOME' }));
    expect(result.applied?.coupon_id).toBe(couponId);
  });

  it('BR-STK-102: BR-PMT-105 — priority is explicit and deterministic, lowest priority number wins, others recorded as excluded', async () => {
    const low = basePromotion({ priority: 10, benefit_type: 'fixed_amount', benefit_value: 1 });
    const high = basePromotion({ priority: 1, benefit_type: 'fixed_amount', benefit_value: 2 });
    // `PromotionRepository.listActiveForEvaluation` is the thing responsible
    // for priority-ascending ordering (see its own comment); this mock
    // returns them already in that order, exactly as evaluate() assumes —
    // the first ELIGIBLE candidate in array order wins.
    const service = serviceWith([high, low]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE());
    expect(result.applied?.discount_amount).toBeCloseTo(2 * 4, 2); // the priority=1 promotion won
    expect(result.candidates.find((c) => c.promotion_id === low.id)?.reason).toBe('lower_priority_excluded');
  });

  it('never applies more than one promotion in this MVP, even with several eligible', async () => {
    const a = basePromotion({ priority: 1 });
    const b = basePromotion({ priority: 2 });
    const service = serviceWith([a, b]);
    const result = await service.evaluate(contextFor(TENANT_A), LINE());
    expect(result.applied?.promotion_id).toBe(a.id);
    expect(result.candidates).toHaveLength(2);
  });
});
