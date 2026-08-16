import { Module } from '@nestjs/common';
import { TaxModule } from '../tax/tax.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { CostVisibilityService } from './cost-visibility.service';
import { PriceBookRepository } from './price-book.repository';
import { PriceBookService } from './price-book.service';
import { PriceBookController } from './price-book.controller';
import { OverridesRepository } from './overrides.repository';
import { OverridesService } from './overrides.service';
import { OverridesController } from './overrides.controller';

@Module({
  imports: [TaxModule, PromotionsModule],
  providers: [
    PricingService,
    CostVisibilityService,
    PriceBookRepository,
    PriceBookService,
    OverridesRepository,
    OverridesService,
  ],
  controllers: [PricingController, PriceBookController, OverridesController],
  exports: [PricingService, CostVisibilityService, PriceBookService, OverridesService],
})
export class PricingModule {}
