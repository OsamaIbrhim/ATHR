import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { OpeningBalanceService } from './opening-balance.service';
import { PostOpeningBalanceDto } from './dto/opening-balance.dto';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@Controller('inventory/opening-balance')
export class OpeningBalanceController {
  constructor(private readonly svc: OpeningBalanceService) {}

  @RequirePermission('inventory.adjustment.post')
  @Post()
  @HttpCode(200)
  post(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: PostOpeningBalanceDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.post(ctx, dto, req.user);
  }
}
