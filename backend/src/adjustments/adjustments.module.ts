import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsReadService } from './adjustments.read.service';
import { AdjustmentsService } from './adjustments.service';

@Module({
  imports: [InventoryModule],
  providers: [AdjustmentsService, AdjustmentsReadService],
  controllers: [AdjustmentsController],
})
export class AdjustmentsModule {}
