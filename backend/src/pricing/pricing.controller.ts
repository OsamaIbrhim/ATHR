import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { PricingService } from './pricing.service';
import { CostVisibilityService } from './cost-visibility.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { PromotionEvaluationService } from '../promotions/promotion-evaluation.service';

@Controller('pricing')
@RequireCapabilities('products.read')
export class PricingController {
  constructor(
    private pricing: PricingService,
    private costVisibility: CostVisibilityService,
    private promotionEvaluation: PromotionEvaluationService,
  ) {}

  /**
   * BR-CST-101 / Permission Matrix §17: the floor in `min_allowed_price` is
   * the variant's cost whenever the resolved entry carries no explicit
   * `floor_price`, so it is masked by *permission*
   * (`pricing.cost.view`/`pricing.margin.view`), not by role name. The
   * previous `role !== 'cashier'` test was the same defect in another
   * costume — it hard-coded one legacy role name and said nothing about
   * whichever role a tenant actually gives its tills.
   *
   * WP-008 Phase D: this is the ONE place Promotion evaluation is wired in
   * (the schema's design comment; see `PromotionEvaluationService`'s header
   * for why — nowhere else, in particular never `PricingService.
   * calculateMany`/`SalesService.createSale`, changes in this phase). BR-CERR-
   * 202: `evaluate()` cannot throw, so the base `quote` — computed first, and
   * projected through `costVisibility` exactly as before this phase —  is
   * always returned even if promotion evaluation fails; the `promotion` field
   * is additive and never replaces `unit_price`/`selling_price`, so an
   * existing caller that ignores the new field sees no behavior change.
   */
  @RequirePermission('pricing.price-book.view')
  @Post('calculate')
  async calculate(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CalculatePriceDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const quote = await this.pricing.calculate(ctx, dto.variant_id, undefined, dto.qty);
    const projected = await this.costVisibility.projectQuote(req.user, quote);
    const evaluation = await this.promotionEvaluation.evaluate(ctx, {
      variantId: dto.variant_id,
      qty: dto.qty,
      unitNetPrice: quote.net_price,
      taxRateSnapshot: quote.tax.rate_snapshot,
      taxModeSnapshot: quote.tax.mode_snapshot,
      couponCode: dto.coupon_code ?? null,
      customerId: dto.customer_id ?? null,
      branchId: dto.branch_id ?? null,
    });
    return {
      ...projected,
      promotion: {
        applied: evaluation.applied,
        candidates: evaluation.candidates,
        evaluation_failed: evaluation.evaluationFailed,
      },
    };
  }
}
