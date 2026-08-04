import { Module } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { TerminalsModule } from '../terminals/terminals.module';
import { ShiftsRepository } from './shifts.repository';

@Module({
  imports: [TerminalsModule],
  providers: [ShiftsService, ShiftsRepository],
  controllers: [ShiftsController],
  exports: [ShiftsService, ShiftsRepository],
})
export class ShiftsModule {}
