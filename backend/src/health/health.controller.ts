import {
  Controller,
  Get,
  ServiceUnavailableException,
  UseFilters,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { releaseMetadata } from '../config/release-metadata';
import { AthrExceptionFilter } from '../common/http/athr-exception.filter';
import { Envelope } from '../common/http/response-envelope.interceptor';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // WP-003 proof-of-concept query endpoint — see
  // docs/architecture/api-error-contract-foundation.md. `@UseFilters` here is
  // route-scoped on purpose: it lets AthrExceptionFilter take over for this
  // handler without touching the app-wide ApiExceptionFilter that still
  // governs every other (not yet migrated) route.
  @Public()
  @Envelope('query')
  @UseFilters(AthrExceptionFilter)
  @Get('live')
  live() {
    return {
      status: 'ok',
      ...releaseMetadata(),
    };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return {
        status: 'ok',
        ...releaseMetadata(),
        database: 'ready',
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        ...releaseMetadata(),
        database: 'unavailable',
      });
    }
  }
}
