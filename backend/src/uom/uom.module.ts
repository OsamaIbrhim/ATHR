import { Module } from '@nestjs/common';
import { UomService } from './uom.service';
import { UomController } from './uom.controller';
import { UomRepository } from './uom.repository';

@Module({
  providers: [UomService, UomRepository],
  controllers: [UomController],
  exports: [UomService, UomRepository],
})
export class UomModule {}
