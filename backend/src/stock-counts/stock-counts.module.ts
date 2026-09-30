import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { StockCountScansService } from './stock-count-scans.service';
import { StockCountsController } from './stock-counts.controller';
import { StockCountsReadService } from './stock-counts.read.service';
import { StockCountsService } from './stock-counts.service';

@Module({
  imports: [InventoryModule],
  providers: [StockCountsService, StockCountScansService, StockCountsReadService],
  controllers: [StockCountsController],
})
export class StockCountsModule {}
