import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { SellersService } from './sellers.service';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import {
  UpdateCommissionSettingsDto,
  UpdateSellerCommissionDto,
} from './dto/commission-settings.dto';
import { CloseSellerPeriodDto } from './dto/close-period.dto';

@Controller('sellers')
export class SellersController {
  constructor(private service: SellersService) {}

  @Get('report')
  @RequirePermission('sellers.report.view')
  report(
    @TenantCtx() ctx: TenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branch_id') branchId: string | undefined,
    @Query('seller_id') sellerId: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.report(
      ctx,
      from,
      to,
      resolveBranchScope(req.user, branchId),
      sellerId,
    );
  }

  @Get('commission-settings')
  @RequirePermission('sellers.report.view')
  settings(@TenantCtx() ctx: TenantContext, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.service.settings(ctx, req.user);
  }

  @Patch('commission-settings')
  @RequirePermission('sellers.commission.manage')
  updateSettings(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: UpdateCommissionSettingsDto,
  ) {
    return this.service.updateSettings(ctx, dto);
  }

  @Patch(':id/commission-settings')
  @RequirePermission('sellers.commission.manage')
  updateSellerSettings(
    @TenantCtx() ctx: TenantContext,
    @Param('id') sellerId: string,
    @Body() dto: UpdateSellerCommissionDto,
  ) {
    return this.service.updateSellerSettings(ctx, sellerId, dto);
  }

  @Get('periods')
  @RequirePermission('sellers.report.view')
  periods(@TenantCtx() ctx: TenantContext, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.service.periods(ctx, req.user);
  }

  @Post('periods/close')
  @RequirePermission('sellers.period.close')
  closePeriod(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CloseSellerPeriodDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.closePeriod(ctx, dto.from, dto.to, req.user);
  }
}
