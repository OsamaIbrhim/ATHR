import { Injectable } from '@nestjs/common';
import type { MembershipRole } from '@prisma/client';
import { OverridesRepository } from './overrides.repository';
import { PricingService } from './pricing.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { decimal, money } from '../common/money';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { ApplyOverrideDto, PriceOverridePolicyDto } from './dto/override.dto';
import { ApplyDiscountDto } from './dto/discount.dto';

/**
 * WP-008 Phase B (BR-OVP-1xx, BR-DSC-2xx, Permission Matrix §17).
 *
 * Manual override and discount are kept as distinct entities (BR-OVP-100):
 * an override changes the applied unit price directly (within a
 * role-configured limit, `pricing.manual-override.apply`), a discount is a
 * separate calculated adjustment on top of the resolved price. Neither ever
 * mutates the Price Book (BR-OVP-103/BR-DSC-205) — both are audit rows
 * against the price the evaluation engine resolved at the moment they were
 * applied.
 */
@Injectable()
export class OverridesService {
  constructor(
    private readonly repository: OverridesRepository,
    private readonly pricing: PricingService,
    private readonly permissionPolicy: PermissionPolicyService,
  ) {}

  savePolicy(context: TenantContext, role: MembershipRole, dto: PriceOverridePolicyDto) {
    return this.repository.savePolicy(context, role, {
      maxDiscountPercent: dto.max_discount_percent ?? null,
      maxDiscountAmount: dto.max_discount_amount ?? null,
      allowPriceIncrease: dto.allow_price_increase ?? true,
    });
  }

  listOverrides(context: TenantContext, variantId?: string) {
    return this.repository.listOverrides(context, variantId);
  }

  listDiscounts(context: TenantContext, variantId?: string) {
    return this.repository.listDiscounts(context, variantId);
  }

  /**
   * BR-OVP-101/102: validates the override against the calling role's
   * configured limit and the resolved floor before recording it. Below-floor
   * requires `pricing.manual-override.above-threshold` — holding
   * `pricing.manual-override.apply` alone never implies it (WP-008 Phase B
   * §B.4.5).
   */
  async applyOverride(context: TenantContext, actor: AuthenticatedUser, dto: ApplyOverrideDto) {
    const quote = await this.pricing.calculate(context, dto.variant_id, undefined, dto.qty ?? 1);
    const basePrice = decimal(quote.net_price);
    const floor = decimal(quote.min_allowed_price);
    const overridePrice = decimal(dto.override_price);

    if (overridePrice.lt(0)) {
      throw new AthrDomainError(
        'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED',
        'override_price must not be negative.',
      );
    }

    const role = actor.membership_role ?? null;
    const policy = role ? await this.repository.findPolicy(context, role) : null;

    if (overridePrice.gt(basePrice)) {
      if (policy && policy.allow_price_increase === false) {
        throw new AthrDomainError(
          'PRICING_OVERRIDE_LIMIT_EXCEEDED',
          'This role is not permitted to increase the price via a manual override.',
        );
      }
    } else if (overridePrice.lt(basePrice)) {
      const discountAmount = basePrice.minus(overridePrice);
      const discountPercent = basePrice.gt(0) ? discountAmount.div(basePrice).mul(100) : decimal(0);
      if (policy?.max_discount_percent != null && discountPercent.gt(policy.max_discount_percent)) {
        throw new AthrDomainError(
          'PRICING_OVERRIDE_LIMIT_EXCEEDED',
          `Override discount ${discountPercent.toFixed(2)}% exceeds this role's configured limit of ${policy.max_discount_percent}%.`,
        );
      }
      if (policy?.max_discount_amount != null && discountAmount.gt(policy.max_discount_amount)) {
        throw new AthrDomainError(
          'PRICING_OVERRIDE_LIMIT_EXCEEDED',
          `Override discount ${discountAmount.toFixed(2)} exceeds this role's configured limit of ${policy.max_discount_amount}.`,
        );
      }
    }

    const isBelowFloor = overridePrice.lt(floor);
    let approvedBy: string | null = null;
    let approvedAt: Date | null = null;
    if (isBelowFloor) {
      // BR-OVP-102: a distinct, explicitly-grantable permission — never
      // implied by `pricing.manual-override.apply`. Holding it is itself the
      // authorization to record the approval (unlike Price Book approval,
      // which additionally requires an independent approver).
      const canApproveBelowFloor = role
        ? await this.permissionPolicy.hasPermission(role, 'pricing.manual-override.above-threshold')
        : false;
      if (!canApproveBelowFloor) {
        throw new AthrDomainError(
          'PRICING_OVERRIDE_BELOW_FLOOR_REQUIRES_APPROVAL',
          `Override price ${overridePrice.toFixed(2)} is below the floor (${floor.toFixed(2)}); this requires "pricing.manual-override.above-threshold".`,
        );
      }
      approvedBy = actor.sub;
      approvedAt = new Date();
    }

    return this.repository.createOverride(context, {
      variantId: dto.variant_id,
      reference: dto.reference ?? null,
      basePrice: money(basePrice),
      overridePrice: money(overridePrice),
      floorPrice: money(floor),
      isBelowFloor,
      reason: dto.reason,
      appliedBy: actor.sub,
      approvedBy,
      approvedAt,
    });
  }

  /** BR-DSC-200/202/203: a calculated adjustment, distinct from an override; never negative. */
  async applyDiscount(context: TenantContext, actor: AuthenticatedUser, dto: ApplyDiscountDto) {
    const quote = await this.pricing.calculate(context, dto.variant_id, undefined, dto.qty ?? 1);
    const basePrice = decimal(quote.net_price);

    let finalPrice: ReturnType<typeof decimal>;
    if (dto.basis === 'percentage') {
      if (dto.amount > 100) {
        throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', 'A percentage discount amount must be between 0 and 100.');
      }
      finalPrice = basePrice.mul(decimal(100).minus(dto.amount)).div(100);
    } else {
      finalPrice = basePrice.minus(dto.amount);
    }
    finalPrice = money(finalPrice);
    if (finalPrice.lt(0)) {
      throw new AthrDomainError(
        'PRICING_DISCOUNT_EXCEEDS_BASE_PRICE',
        `A discount of ${dto.amount} (${dto.basis}) would take the price below zero (base ${basePrice.toFixed(2)}).`,
      );
    }

    // BR-DSC-203: manual discounts share the same role-configured limits as overrides.
    const role = actor.membership_role ?? null;
    const policy = role ? await this.repository.findPolicy(context, role) : null;
    const discountAmount = basePrice.minus(finalPrice);
    const discountPercent = basePrice.gt(0) ? discountAmount.div(basePrice).mul(100) : decimal(0);
    if (policy?.max_discount_percent != null && discountPercent.gt(policy.max_discount_percent)) {
      throw new AthrDomainError(
        'PRICING_OVERRIDE_LIMIT_EXCEEDED',
        `Discount ${discountPercent.toFixed(2)}% exceeds this role's configured limit of ${policy.max_discount_percent}%.`,
      );
    }
    if (policy?.max_discount_amount != null && discountAmount.gt(policy.max_discount_amount)) {
      throw new AthrDomainError(
        'PRICING_OVERRIDE_LIMIT_EXCEEDED',
        `Discount ${discountAmount.toFixed(2)} exceeds this role's configured limit of ${policy.max_discount_amount}.`,
      );
    }

    return this.repository.createDiscount(context, {
      variantId: dto.variant_id,
      reference: dto.reference ?? null,
      source: 'manual',
      basis: dto.basis,
      amount: dto.amount,
      basePrice: money(basePrice),
      finalPrice,
      reason: dto.reason ?? null,
      appliedBy: actor.sub,
    });
  }
}
