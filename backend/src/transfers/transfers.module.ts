import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { InventoryModule } from '../inventory/inventory.module';
@Module({ imports: [InventoryModule], providers: [TransfersService], controllers: [TransfersController] })
export class TransfersModule {}
