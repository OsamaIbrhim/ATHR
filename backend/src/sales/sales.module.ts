import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesReadService } from './sales-read.service';
import { SalesController } from './sales.controller';
import { PricingModule } from '../pricing/pricing.module';
import { InvoicePdfService } from './invoice-pdf.service';
import { TerminalsModule } from '../terminals/terminals.module';
import { ShiftsModule } from '../shifts/shifts.module';
import {
  PosSaleReviewsController,
  SaleReviewsController,
} from './sale-reviews.controller';
import { SaleReviewsService } from './sale-reviews.service';

@Module({
  imports: [PricingModule, TerminalsModule, ShiftsModule],
  providers: [
    SalesService,
    SalesReadService,
    InvoicePdfService,
    SaleReviewsService,
  ],
  controllers: [
    SalesController,
    PosSaleReviewsController,
    SaleReviewsController,
  ],
  exports: [SalesService],
})
export class SalesModule {}
