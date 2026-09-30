import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { TaxModule } from '../tax/tax.module';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './product-import.service';

@Module({
  imports: [InventoryModule, TaxModule],
  providers: [ProductImportService],
  controllers: [ProductImportController],
})
export class ProductImportModule {}
