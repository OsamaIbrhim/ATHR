import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { OpeningBalanceController } from './opening-balance.controller';
import { OpeningBalanceService } from './opening-balance.service';

@Module({
  imports: [InventoryModule],
  providers: [OpeningBalanceService],
  controllers: [OpeningBalanceController],
  exports: [OpeningBalanceService],
})
export class OpeningBalanceModule {}
