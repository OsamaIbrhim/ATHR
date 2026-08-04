import { Module } from '@nestjs/common';
import { TerminalsController } from './terminals.controller';
import { TerminalsService } from './terminals.service';
import { TerminalsRepository } from './terminals.repository';

@Module({
  controllers: [TerminalsController],
  providers: [TerminalsService, TerminalsRepository],
  exports: [TerminalsService, TerminalsRepository],
})
export class TerminalsModule {}
