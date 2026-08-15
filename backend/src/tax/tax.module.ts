import { Module } from '@nestjs/common';
import { TaxCodeRepository } from './tax-code.repository';
import { TaxCodeService } from './tax-code.service';
import { TaxExemptionService } from './tax-exemption.service';
import { TaxResolutionService } from './tax-resolution.service';
import { SalesTaxSnapshotService } from './sales-tax-snapshot.service';
import { TaxController } from './tax.controller';

/**
 * WP-008 Phase C.
 *
 * CLAUDE.md §2.2 / WP-008 compliance item 2.2: `PricingModule` and
 * `SalesModule` consume `TaxResolutionService`/`SalesTaxSnapshotService`
 * through this module's exports — they never reach into `TaxCodeRepository`
 * directly, so the dependency direction stays pricing -> tax and sales -> tax,
 * with no edge back.
 */
@Module({
  providers: [
    TaxCodeRepository,
    TaxCodeService,
    TaxExemptionService,
    TaxResolutionService,
    SalesTaxSnapshotService,
  ],
  controllers: [TaxController],
  exports: [TaxResolutionService, SalesTaxSnapshotService, TaxCodeService, TaxExemptionService],
})
export class TaxModule {}
