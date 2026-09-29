import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SalesModule } from '../sales/sales.module';
import { PricingModule } from '../pricing/pricing.module';
import { TaxModule } from '../tax/tax.module';
import { TerminalsModule } from '../terminals/terminals.module';
import { InventoryModule } from '../inventory/inventory.module';
@Module({ imports: [SalesModule, PricingModule, TaxModule, TerminalsModule, InventoryModule], providers: [SyncService], controllers: [SyncController] })
export class SyncModule {}
