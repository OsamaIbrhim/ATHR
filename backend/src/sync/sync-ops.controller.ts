import { Body, Controller, Post } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PlatformRoute } from '../entitlements/platform/platform-admin.guard';
import { SyncCompactionService } from './sync-compaction.service';

class CompactDto {
  /** Tills not seen for this many days no longer hold back compaction. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  retention_days?: number;
}

/** Operations endpoint (platform admins only): schedule it daily. */
@PlatformRoute()
@Controller('platform/sync')
export class SyncOpsController {
  constructor(private readonly compaction: SyncCompactionService) {}

  @Post('compact')
  compact(@Body() dto: CompactDto) {
    return this.compaction.compact(dto.retention_days);
  }
}
