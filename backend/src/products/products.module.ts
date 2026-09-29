import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { ProductsRepository } from './products.repository';
import { BrandsModule } from '../brands/brands.module';
import { TaxModule } from '../tax/tax.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [BrandsModule, TaxModule, CatalogModule],
  providers: [ProductsService, ProductsRepository],
  controllers: [ProductsController],
  exports: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
