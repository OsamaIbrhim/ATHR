import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SyncCompactionService } from './sync-compaction.service';
import { SyncOpsController } from './sync-ops.controller';
import { SalesModule } from '../sales/sales.module';
import { PricingModule } from '../pricing/pricing.module';
import { TaxModule } from '../tax/tax.module';
import { TerminalsModule } from '../terminals/terminals.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [SalesModule, PricingModule, TaxModule, TerminalsModule, InventoryModule],
  providers: [SyncService, SyncCompactionService],
  controllers: [SyncController, SyncOpsController],
})
export class SyncModule {}
