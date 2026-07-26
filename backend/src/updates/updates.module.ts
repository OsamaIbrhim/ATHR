import { Module } from '@nestjs/common';
import {
  PosCompatibilityController,
  UpdatesController,
} from './updates.controller';

@Module({
  controllers: [UpdatesController, PosCompatibilityController],
})
export class UpdatesModule {}
