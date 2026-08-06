import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { BrandsRepository } from './brands.repository';

@Module({
  providers: [BrandsService, BrandsRepository],
  controllers: [BrandsController],
  exports: [BrandsService, BrandsRepository],
})
export class BrandsModule {}
