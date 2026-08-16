import { Injectable } from '@nestjs/common';
import type { Coupon, CouponRedemption } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import { PromotionRepository } from './promotion.repository';
import { CouponRepository } from './coupon.repository';
import type { CreateCouponDto, ListCouponsDto, RedeemCouponDto, UpdateCouponDto } from './dto/coupon.dto';

/**
 * WP-008 Phase D — `Coupon` (BR-CPN-2xx), a distinct entity from `Promotion`
 * (BR-CPN-200): it owns its own code, status and usage limits.
 *
 * Online-first per OD-CAT-008/009 (BR doc §35 numbering — see the Phase D PR
 * description for the off-by-one against the WP document's OD-CAT-009
 * citation): every method here requires a live database round trip
 * (`CouponRepository.redeem`'s structural constraint, the centralized
 * `use_count`). Per `ATHR Offline Protocol v1.0` §12, offline coupon use is
 * conditionally allowed ONLY if "Offline-verifiable وغير متطلب central
 * counter" — this coupon design is centrally-countered by construction
 * (BR-CPN-205: "Limits مركزية... ولا تعتمد على Cache فقط"), so it does NOT
 * qualify and no offline redemption path is built or claimed in this phase.
 *
 * BR-CPN-206: no method here logs, throws, or returns the raw submitted code
 * once it fails to resolve — `COUPON_INVALID_OR_EXPIRED`'s message never
 * repeats the caller's input.
 */
@Injectable()
export class CouponService {
  constructor(
    private readonly coupons: CouponRepository,
    private readonly promotions: PromotionRepository,
  ) {}

  async list(context: TenantContext, dto: ListCouponsDto = {}) {
    const { rows, total } = await this.coupons.list(context, {
      promotionId: dto.promotion_id,
      status: dto.status,
      page: dto.page,
      pageSize: dto.page_size,
    });
    return { items: rows, total, page: dto.page ?? 1, page_size: dto.page_size ?? 20 };
  }

  async findOne(context: TenantContext, id: string): Promise<Coupon> {
    return this.coupons.assertInTenant(context, id);
  }

  async create(context: TenantContext, actorId: string, dto: CreateCouponDto): Promise<Coupon> {
    // Tenant-scoped existence check before the FK would reject it, so a
    // cross-tenant promotion id reads as "not found" (Multi-tenancy
    // Blueprint §32), same precedent as `TaxCodeService.create`.
    await this.promotions.assertInTenant(context, dto.promotion_id);

    const type = dto.type ?? 'public';
    if (type === 'customer_bound' && !dto.customer_id) {
      throw new AthrDomainError(
        'REQUEST_FIELD_VALUE_INVALID',
        'A "customer_bound" coupon requires customer_id.',
      );
    }

    return this.coupons.create(context, {
      promotionId: dto.promotion_id,
      codeDisplay: dto.code,
      type,
      customerId: type === 'customer_bound' ? (dto.customer_id ?? null) : null,
      maxTotalUses: dto.max_total_uses ?? null,
      maxUsesPerCustomer: dto.max_uses_per_customer ?? null,
      expiresAt: dto.expires_at ? new Date(dto.expires_at) : null,
      createdBy: actorId,
    });
  }

  async update(context: TenantContext, id: string, dto: UpdateCouponDto): Promise<Coupon> {
    return this.coupons.update(context, id, {
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.max_total_uses !== undefined ? { max_total_uses: dto.max_total_uses } : {}),
      ...(dto.max_uses_per_customer !== undefined
        ? { max_uses_per_customer: dto.max_uses_per_customer }
        : {}),
      ...(dto.expires_at !== undefined
        ? { expires_at: dto.expires_at ? new Date(dto.expires_at) : null }
        : {}),
    });
  }

  /**
   * BR-CPN-204: idempotent — `idempotencyKey` comes from the caller's
   * `Idempotency-Key` HTTP header (`CouponController.redeem`), never a body
   * field. See `CouponRepository.redeem` for the structural guarantee and
   * its one documented non-atomic edge (`max_uses_per_customer`).
   */
  async redeem(
    context: TenantContext,
    actorId: string,
    idempotencyKey: string,
    dto: RedeemCouponDto,
  ): Promise<{ redemption: CouponRedemption; replay: boolean }> {
    const coupon = await this.coupons.findByCode(context, dto.code);
    if (!coupon) {
      throw new AthrDomainError('COUPON_INVALID_OR_EXPIRED', 'Coupon code is invalid or expired.');
    }
    if (coupon.status !== 'active') {
      throw new AthrDomainError('COUPON_INVALID_OR_EXPIRED', 'Coupon code is invalid or expired.');
    }
    if (coupon.expires_at && coupon.expires_at.getTime() < Date.now()) {
      throw new AthrDomainError('COUPON_INVALID_OR_EXPIRED', 'Coupon code is invalid or expired.');
    }
    if (coupon.type === 'customer_bound') {
      if (!dto.customer_id || dto.customer_id !== coupon.customer_id) {
        throw new AthrDomainError('COUPON_INVALID_OR_EXPIRED', 'Coupon code is invalid or expired.');
      }
    }
    const promotion = await this.promotions.assertInTenant(context, coupon.promotion_id);
    if (promotion.status !== 'active') {
      throw new AthrDomainError('COUPON_INVALID_OR_EXPIRED', 'Coupon code is invalid or expired.');
    }

    // Per-customer cap: a read-then-write pre-flight, not structural — see
    // `CouponRepository.redeem`'s doc comment for why this one dimension is
    // an accepted, documented race window rather than a full guarantee.
    if (coupon.max_uses_per_customer && dto.customer_id) {
      const priorCount = await this.coupons.countRedemptionsForCustomer(
        context,
        coupon.id,
        dto.customer_id,
      );
      if (priorCount >= coupon.max_uses_per_customer) {
        throw new AthrDomainError(
          'COUPON_USAGE_LIMIT_EXCEEDED',
          `Coupon ${coupon.id} has reached its per-customer usage limit (BR-CPN-205).`,
        );
      }
    }

    return this.coupons.redeem(context, coupon.id, idempotencyKey, {
      customerId: dto.customer_id ?? null,
      amountApplied: dto.amount_applied ?? null,
      redeemedBy: actorId,
    });
  }
}
