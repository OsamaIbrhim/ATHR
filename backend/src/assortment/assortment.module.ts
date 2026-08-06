import { Module } from '@nestjs/common';
import { AssortmentService } from './assortment.service';
import { AssortmentController } from './assortment.controller';
import { AssortmentRepository } from './assortment.repository';
import { BranchesModule } from '../branches/branches.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [BranchesModule, ProductsModule],
  providers: [AssortmentService, AssortmentRepository],
  controllers: [AssortmentController],
  exports: [AssortmentService, AssortmentRepository],
})
export class AssortmentModule {}
