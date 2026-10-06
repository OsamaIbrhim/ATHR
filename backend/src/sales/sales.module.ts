import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesReadService } from './sales-read.service';
import { ReturnsService } from './returns.service';
import { ExchangeService } from './exchange.service';
import { ReturnsReadService } from './returns-read.service';
import { SalesController } from './sales.controller';
import { PricingModule } from '../pricing/pricing.module';
import { TaxModule } from '../tax/tax.module';
import { InvoicePdfService } from './invoice-pdf.service';
import { TerminalsModule } from '../terminals/terminals.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [PricingModule, TaxModule, TerminalsModule, InventoryModule],
  providers: [
    SalesService,
    SalesReadService,
    ReturnsService,
    ReturnsReadService,
    ExchangeService,
    InvoicePdfService,
  ],
  controllers: [SalesController],
  exports: [SalesService, ReturnsService],
})
export class SalesModule {}
