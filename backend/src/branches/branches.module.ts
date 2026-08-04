import { Module } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { BranchesController } from './branches.controller';
import { BranchesRepository } from './branches.repository';

@Module({
  providers: [BranchesService, BranchesRepository],
  controllers: [BranchesController],
  exports: [BranchesService, BranchesRepository],
})
export class BranchesModule {}
