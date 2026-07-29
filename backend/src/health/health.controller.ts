import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { releaseMetadata } from '../config/release-metadata';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
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
