import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Promotion, PromotionBenefitType, TaxMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { decimal, money } from '../common/money';
import type { TenantScope } from '../identity/tenant-context.type';
import { PromotionRepository } from './promotion.repository';
import { CouponRepository } from './coupon.repository';

export interface PromotionEvaluationLine {
  readonly variantId: string;
  readonly qty: number;
  /** Ex-tax unit price, as already resolved by `PricingService.calculate` for this line. */
  readonly unitNetPrice: number;
  readonly taxRateSnapshot: Prisma.Decimal.Value;
  readonly taxModeSnapshot: TaxMode;
  readonly couponCode?: string | null;
  readonly customerId?: string | null;
  readonly branchId?: string | null;
}

export interface PromotionCandidateTrace {
  readonly promotion_id: string;
  readonly name: string;
  readonly eligible: boolean;
  readonly reason: string;
}

export interface AppliedPromotion {
  readonly promotion_id: string;
  readonly name: string;
  readonly benefit_type: PromotionBenefitType;
  readonly discounted_units: number;
  readonly discount_amount: number;
  readonly effective_unit_net_price: number;
  readonly effective_tax_amount: number;
  readonly effective_selling_price: number;
  readonly coupon_id?: string;
}

export interface PromotionEvaluationResult {
  readonly applied: AppliedPromotion | null;
  readonly candidates: readonly PromotionCandidateTrace[];
  /** BR-CERR-202: true when evaluation itself failed — the base (pre-promotion) price is what the caller must use. */
  readonly evaluationFailed: boolean;
}

const NO_DISCOUNT: PromotionEvaluationResult = { applied: null, candidates: [], evaluationFailed: false };

/**
 * WP-008 Phase D — BR-CND-1xx eligibility + BR-BEN-1xx benefit calculation,
 * wired into `PricingController.calculate` only (the read-only
 * `POST /pricing/calculate` quote endpoint), per the schema's design
 * comment. Deliberately independent of `PricingModule`/`PricingService`: it
 * receives an already-resolved line (variant id, qty, the ex-tax unit price
 * and the tax rate/mode `TaxResolutionService` already snapshotted for that
 * price) and returns a discount to apply on top, rather than reaching back
 * into pricing or tax internals (CLAUDE.md §2.2 — dependency direction has no
 * edge from Promotions back into Pricing or Tax).
 *
 * MVP shape limitation, stated plainly rather than silently outgrown: this
 * endpoint prices ONE variant at a specific qty, not a cart. Consequently:
 *
 *   - BOGO (BR-BEN-104) is evaluated only WITHIN this single line — "buy N of
 *     THIS variant, get M of THIS SAME variant at a discount". A buy-item /
 *     get-DIFFERENT-item BOGO needs cart-level visibility this endpoint does
 *     not have, and is out of scope here — see the Phase D PR description.
 *   - `min_spend` (BR-CND-100/102, an order-level condition) can never be
 *     evaluated against a single line's total, so any promotion with
 *     `min_spend` set is excluded from eligibility with reason
 *     `min_spend_requires_cart_context`, never silently ignored or silently
 *     assumed satisfied. Real cart-level evaluation is WP-010's, per the WP
 *     document's own "Blocks" line.
 *
 * BR-STK-102/BR-PMT-105: MVP applies AT MOST ONE promotion regardless of
 * `stackability`, chosen by lowest `priority` value with a deterministic
 * tiebreak (`PromotionRepository.listActiveForEvaluation`'s ordering) — never
 * database row order. Every other eligible candidate is recorded in
 * `candidates` with `reason: 'lower_priority_excluded'`, satisfying
 * BR-STK-102's "records alternatives and why" without implementing true
 * multi-promotion stacking (OD-CAT-007 defers that).
 *
 * BR-CERR-202: `evaluate()` NEVER throws. Any failure — a bad promotion
 * configuration, a DB error, anything — is caught, logged via the registered
 * `PROMOTION_EVALUATION_FAILED` code, and reported back as
 * `evaluationFailed: true` with `applied: null`, so the caller always still
 * has the base price to sell at. This is tested as failure injection, not
 * just a happy path — see `promotion-evaluation.failure-injection.spec.ts`.
 */
@Injectable()
export class PromotionEvaluationService {
  private readonly logger = new Logger(PromotionEvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionRepository,
    private readonly coupons: CouponRepository,
  ) {}

  async evaluate(context: TenantScope, line: PromotionEvaluationLine): Promise<PromotionEvaluationResult> {
    try {
      return await this.evaluateUnsafe(context, line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `PROMOTION_EVALUATION_FAILED for variant ${line.variantId}: ${detail} — falling back to base price (BR-CERR-202).`,
      );
      return { applied: null, candidates: [], evaluationFailed: true };
    }
  }

  private async evaluateUnsafe(
    context: TenantScope,
    line: PromotionEvaluationLine,
  ): Promise<PromotionEvaluationResult> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: line.variantId, tenant_id: context.tenantId },
      select: { id: true, product_id: true, product: { select: { brand_id: true, category_id: true } } },
    });
    if (!variant) return NO_DISCOUNT;

    const candidatePromotions = await this.promotions.listActiveForEvaluation(context);
    if (candidatePromotions.length === 0) return NO_DISCOUNT;

    const traces: PromotionCandidateTrace[] = [];
    let winner: Promotion | null = null;
    let winnerCouponId: string | undefined;

    for (const promotion of candidatePromotions) {
      const { eligible, reason, couponId } = await this.checkEligibility(context, promotion, variant, line);
      traces.push({ promotion_id: promotion.id, name: promotion.name, eligible, reason });
      if (eligible && !winner) {
        winner = promotion;
        winnerCouponId = couponId;
      } else if (eligible) {
        // A previously-recorded trace already won at a higher priority —
        // demote this one's recorded reason (BR-STK-102).
        traces[traces.length - 1] = {
          promotion_id: promotion.id,
          name: promotion.name,
          eligible: true,
          reason: 'lower_priority_excluded',
        };
      }
    }

    if (!winner) return { applied: null, candidates: traces, evaluationFailed: false };

    const benefit = this.computeBenefit(winner, line);
    if (!benefit) return { applied: null, candidates: traces, evaluationFailed: false };

    return {
      applied: { ...benefit, promotion_id: winner.id, name: winner.name, coupon_id: winnerCouponId },
      candidates: traces,
      evaluationFailed: false,
    };
  }

  private async checkEligibility(
    context: TenantScope,
    promotion: Promotion,
    variant: { id: string; product_id: string; product: { brand_id: string | null; category_id: string | null } },
    line: PromotionEvaluationLine,
  ): Promise<{ eligible: boolean; reason: string; couponId?: string }> {
    if (!this.scopeMatches(promotion, variant)) return { eligible: false, reason: 'scope_mismatch' };

    if (promotion.min_qty && decimal(line.qty).lt(decimal(promotion.min_qty))) {
      return { eligible: false, reason: 'min_qty_not_met' };
    }

    // BR-CND-100/102: order-level condition, not evaluable at single-line
    // quote granularity — see this class's header comment.
    if (promotion.min_spend) return { eligible: false, reason: 'min_spend_requires_cart_context' };

    if (promotion.branch_id) {
      if (!line.branchId || line.branchId !== promotion.branch_id) {
        return { eligible: false, reason: 'branch_mismatch' };
      }
    }

    if (promotion.customer_id) {
      if (!line.customerId || line.customerId !== promotion.customer_id) {
        return { eligible: false, reason: 'customer_mismatch' };
      }
    }

    if (promotion.requires_coupon) {
      if (!line.couponCode) return { eligible: false, reason: 'requires_coupon' };
      const coupon = await this.coupons.findByCode(context, line.couponCode);
      if (
        !coupon ||
        coupon.promotion_id !== promotion.id ||
        coupon.status !== 'active' ||
        (coupon.expires_at && coupon.expires_at.getTime() < Date.now()) ||
        (coupon.type === 'customer_bound' && coupon.customer_id !== (line.customerId ?? null))
      ) {
        // BR-CPN-206: never echo the submitted code.
        return { eligible: false, reason: 'coupon_invalid' };
      }
      return { eligible: true, reason: 'eligible', couponId: coupon.id };
    }

    return { eligible: true, reason: 'eligible' };
  }

  private scopeMatches(
    promotion: Promotion,
    variant: { id: string; product_id: string; product: { brand_id: string | null; category_id: string | null } },
  ): boolean {
    switch (promotion.scope_type) {
      case 'all':
        return true;
      case 'variant':
        return promotion.scope_id === variant.id;
      case 'product':
        return promotion.scope_id === variant.product_id;
      case 'brand':
        return !!variant.product.brand_id && promotion.scope_id === variant.product.brand_id;
      case 'category':
        return !!variant.product.category_id && promotion.scope_id === variant.product.category_id;
      default:
        return false;
    }
  }

  /**
   * BR-BEN-1xx. All money math on the ex-tax `unitNetPrice` (matching
   * `PriceQuote.net_price`'s basis), then tax is reapplied using the SAME
   * `taxRateSnapshot`/`taxModeSnapshot` the base quote already resolved —
   * intentionally not a second `TaxResolutionService` call, so the
   * promotion-adjusted figure can never disagree with the base quote about
   * which rate version applied. This duplicates
   * `TaxResolutionService.calculate`'s two small formulas rather than taking
   * a new module dependency on Tax for them; if that service's formulas ever
   * change, this must change with them (flagged, not hidden).
   */
  private computeBenefit(
    promotion: Promotion,
    line: PromotionEvaluationLine,
  ): Omit<AppliedPromotion, 'promotion_id' | 'name' | 'coupon_id'> | null {
    const unit = money(line.unitNetPrice);
    const qty = line.qty;
    const cap = promotion.max_units_per_order ? Math.min(qty, promotion.max_units_per_order) : qty;

    let discountedUnits = 0;
    let discountAmount = money(0);

    if (promotion.benefit_type === 'percentage') {
      discountedUnits = cap;
      discountAmount = money(unit.mul(cap).mul(decimal(promotion.benefit_value ?? 0)).div(100));
    } else if (promotion.benefit_type === 'fixed_amount') {
      discountedUnits = cap;
      discountAmount = money(decimal(promotion.benefit_value ?? 0).mul(cap));
    } else if (promotion.benefit_type === 'fixed_price') {
      const target = money(promotion.benefit_value ?? 0);
      if (target.gte(unit)) return null; // BR-BEN-101: never a negative discount.
      discountedUnits = cap;
      discountAmount = money(unit.minus(target).mul(cap));
    } else if (promotion.benefit_type === 'bogo') {
      const buy = promotion.bogo_buy_qty ?? 0;
      const get = promotion.bogo_get_qty ?? 0;
      if (buy <= 0 || get <= 0) return null;
      const groupSize = buy + get;
      const groups = Math.floor(qty / groupSize);
      if (groups <= 0) return null;
      let freeUnits = groups * get;
      if (promotion.max_units_per_order) freeUnits = Math.min(freeUnits, promotion.max_units_per_order);
      discountedUnits = freeUnits;
      discountAmount = money(unit.mul(freeUnits).mul(decimal(promotion.bogo_get_discount_percent ?? 0)).div(100));
    } else {
      return null;
    }

    if (promotion.max_discount_amount) {
      discountAmount = decimal(discountAmount).gt(decimal(promotion.max_discount_amount))
        ? money(promotion.max_discount_amount)
        : discountAmount;
    }
    if (decimal(discountAmount).lte(0)) return null;

    const lineNet = money(unit.mul(qty));
    const effectiveLineNet = money(decimal(lineNet).minus(decimal(discountAmount)).clamp(0, lineNet));
    const effectiveUnitNet = money(decimal(effectiveLineNet).div(qty));

    const rate = decimal(line.taxRateSnapshot);
    let effectiveTax: Prisma.Decimal;
    let effectiveGross: Prisma.Decimal;
    if (line.taxModeSnapshot === 'inclusive') {
      // The original gross-per-unit already contained tax at `rate`; the
      // discount comes out of that same gross, and the tax portion of the
      // NEW gross is re-derived the same way `TaxResolutionService` derives
      // it for any inclusive amount.
      const originalGross = money(unit.mul(decimal(1).plus(rate.div(100))));
      const newGrossPerUnit = money(decimal(originalGross).minus(decimal(discountAmount).div(qty)));
      const newNetPerUnit = money(decimal(newGrossPerUnit).div(decimal(1).plus(rate.div(100))));
      effectiveTax = money(decimal(newGrossPerUnit).minus(decimal(newNetPerUnit)).mul(qty));
      effectiveGross = money(decimal(newGrossPerUnit).mul(qty));
    } else {
      effectiveTax = money(decimal(effectiveUnitNet).mul(rate).div(100).mul(qty));
      effectiveGross = money(decimal(effectiveLineNet).plus(effectiveTax));
    }

    return {
      benefit_type: promotion.benefit_type,
      discounted_units: discountedUnits,
      discount_amount: decimal(discountAmount).toNumber(),
      effective_unit_net_price: decimal(effectiveUnitNet).toNumber(),
      effective_tax_amount: decimal(effectiveTax).toNumber(),
      effective_selling_price: decimal(effectiveGross).toNumber(),
    };
  }
}
