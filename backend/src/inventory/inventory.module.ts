import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';

@Module({
  providers: [InventoryService, InventoryRepository],
  controllers: [InventoryController],
  exports: [InventoryService, InventoryRepository],
})
export class InventoryModule {}
