import { Module } from '@nestjs/common';
import { PromotionRepository } from './promotion.repository';
import { PromotionService } from './promotion.service';
import { PromotionController } from './promotion.controller';
import { CouponRepository } from './coupon.repository';
import { CouponService } from './coupon.service';
import { CouponController } from './coupon.controller';
import { BundleRepository } from './bundle.repository';
import { BundleService } from './bundle.service';
import { BundleController } from './bundle.controller';
import { PromotionEvaluationService } from './promotion-evaluation.service';

/**
 * WP-008 Phase D.
 *
 * CLAUDE.md §2.2: `PricingModule` consumes `PromotionEvaluationService`
 * through this module's exports only — it never reaches into
 * `PromotionRepository`/`CouponRepository`/`BundleRepository` directly, so
 * the dependency direction is pricing -> promotions, with no edge back (this
 * module imports nothing from `PricingModule`/`TaxModule`;
 * `PromotionEvaluationService` receives an already-resolved price/tax line as
 * plain data instead — see that service's header comment).
 */
@Module({
  providers: [
    PromotionRepository,
    PromotionService,
    CouponRepository,
    CouponService,
    BundleRepository,
    BundleService,
    PromotionEvaluationService,
  ],
  controllers: [PromotionController, CouponController, BundleController],
  exports: [PromotionEvaluationService, PromotionService, CouponService, BundleService],
})
export class PromotionsModule {}
