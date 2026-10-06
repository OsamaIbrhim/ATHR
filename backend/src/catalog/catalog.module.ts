import { Module } from '@nestjs/common';
import { ProductTypesController } from './product-types.controller';
import { ProductTypesService } from './product-types.service';
import { TenantSettingsController } from './tenant-settings.controller';

@Module({
  providers: [ProductTypesService],
  controllers: [ProductTypesController, TenantSettingsController],
  exports: [ProductTypesService],
})
export class CatalogModule {}
