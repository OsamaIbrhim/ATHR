import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { LowStockService } from './low-stock.service';

@Module({
  providers: [InventoryService, InventoryRepository, LowStockService],
  controllers: [InventoryController],
  exports: [InventoryService, InventoryRepository],
})
export class InventoryModule {}
