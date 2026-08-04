import { Module } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersRepository } from './suppliers.repository';

@Module({
  providers: [SuppliersService, SuppliersRepository],
  controllers: [SuppliersController],
  exports: [SuppliersService, SuppliersRepository],
})
export class SuppliersModule {}
