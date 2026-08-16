import { randomUUID } from 'crypto';
import { CouponService } from './coupon.service';
import type { CouponRepository } from './coupon.repository';
import type { PromotionRepository } from './promotion.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

/**
 * WP-008 Phase D — `CouponService.redeem`'s PRE-FLIGHT validation (BR-CPN-
 * 202/203/206): invalid code, disabled coupon, expired, wrong customer for a
 * `customer_bound` coupon, inactive promotion, and the per-customer cap.
 *
 * `CouponRepository.redeem` itself (the atomic insert + capacity claim) is
 * hand-mocked here (`jest.fn()`), not exercised — its actual behaviour is
 * real-Postgres-only (`verify-promotion-behaviour.cjs`), since it depends on
 * a genuine unique-constraint violation and a real conditional `UPDATE`,
 * neither of which `fakePrisma` can produce (its `$executeRaw` stub always
 * returns `0`). What IS unit-testable, and matters just as much per BR-CPN-
 * 206, is that `redeem()` never reaches the repository at all for an
 * ineligible coupon, and that its rejection messages never echo the
 * submitted code.
 */

const ACTOR = randomUUID();
const CUSTOMER = randomUUID();
const OTHER_CUSTOMER = randomUUID();
const IDEMPOTENCY_KEY = 'test-idempotency-key-1';

function setup(couponOverrides: Record<string, unknown> = {}, promotionOverrides: Record<string, unknown> = {}) {
  const couponId = randomUUID();
  const promotionId = randomUUID();
  const coupon = {
    id: couponId,
    tenant_id: TENANT_A,
    promotion_id: promotionId,
    code_normalized: 'SECRET1',
    code_display: 'Secret1',
    type: 'public',
    status: 'active',
    customer_id: null,
    max_total_uses: null,
    max_uses_per_customer: null,
    use_count: 0,
    expires_at: null,
    ...couponOverrides,
  };
  const promotion = {
    id: promotionId,
    tenant_id: TENANT_A,
    status: 'active',
    ...promotionOverrides,
  };

  const redeem = jest.fn().mockResolvedValue({
    redemption: { id: randomUUID(), tenant_id: TENANT_A, coupon_id: couponId, idempotency_key: IDEMPOTENCY_KEY },
    replay: false,
  });
  const coupons = {
    findByCode: jest.fn().mockResolvedValue(coupon),
    countRedemptionsForCustomer: jest.fn().mockResolvedValue(0),
    redeem,
  } as unknown as CouponRepository;
  const promotions = {
    assertInTenant: jest.fn().mockResolvedValue(promotion),
  } as unknown as PromotionRepository;

  return { service: new CouponService(coupons, promotions), coupons, ctx: contextFor(TENANT_A), redeem };
}

describe('CouponService.redeem — eligibility pre-flight', () => {
  it('an unknown code is rejected with a generic message that does not echo the code', async () => {
    const { service, coupons, ctx } = setup();
    (coupons.findByCode as jest.Mock).mockResolvedValue(null);
    const secretCode = 'SUPER-SECRET-CODE';
    await expect(
      service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: secretCode }),
    ).rejects.toMatchObject({ code: 'COUPON_INVALID_OR_EXPIRED' });
    try {
      await service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: secretCode });
    } catch (error: any) {
      expect(String(error.message)).not.toContain(secretCode);
    }
  });

  it('a disabled coupon is rejected', async () => {
    const { service, ctx } = setup({ status: 'disabled' });
    await expect(service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: 'Secret1' })).rejects.toMatchObject({
      code: 'COUPON_INVALID_OR_EXPIRED',
    });
  });

  it('an expired coupon is rejected', async () => {
    const { service, ctx } = setup({ expires_at: new Date(Date.now() - 60_000) });
    await expect(service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: 'Secret1' })).rejects.toMatchObject({
      code: 'COUPON_INVALID_OR_EXPIRED',
    });
  });

  it('a customer_bound coupon is rejected for the wrong customer', async () => {
    const { service, ctx } = setup({ type: 'customer_bound', customer_id: CUSTOMER });
    await expect(
      service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: 'Secret1', customer_id: OTHER_CUSTOMER }),
    ).rejects.toMatchObject({ code: 'COUPON_INVALID_OR_EXPIRED' });
  });

  it('a customer_bound coupon succeeds for the bound customer', async () => {
    const { service, ctx, redeem } = setup({ type: 'customer_bound', customer_id: CUSTOMER });
    await service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: 'Secret1', customer_id: CUSTOMER });
    expect(redeem).toHaveBeenCalledWith(
      ctx,
      expect.any(String),
      IDEMPOTENCY_KEY,
      expect.objectContaining({ customerId: CUSTOMER }),
    );
  });

  it('a coupon whose promotion is not active is rejected', async () => {
    const { service, ctx } = setup({}, { status: 'paused' });
    await expect(service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: 'Secret1' })).rejects.toMatchObject({
      code: 'COUPON_INVALID_OR_EXPIRED',
    });
  });

  it('BR-CPN-205: per-customer usage cap is enforced before the repository is even called', async () => {
    const { service, coupons, ctx, redeem } = setup({ max_uses_per_customer: 1 });
    (coupons.countRedemptionsForCustomer as jest.Mock).mockResolvedValue(1);
    await expect(
      service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: 'Secret1', customer_id: CUSTOMER }),
    ).rejects.toMatchObject({ code: 'COUPON_USAGE_LIMIT_EXCEEDED' });
    expect(redeem).not.toHaveBeenCalled();
  });

  it('an eligible redemption delegates to CouponRepository.redeem exactly once', async () => {
    const { service, ctx, redeem } = setup();
    const result = await service.redeem(ctx, ACTOR, IDEMPOTENCY_KEY, { code: 'Secret1' });
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(result.replay).toBe(false);
  });
});
