import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { SellersService } from './sellers.service';
import { RequireCapabilities } from '../auth/roles.guard';
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
  @RequireCapabilities('seller_reports.read')
  @RequirePermission('reports.sales.view')
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
      resolveBranchScope(req.user, branchId, ['owner']),
      sellerId,
    );
  }

  @Get('commission-settings')
  @RequireCapabilities('seller_reports.read')
  @RequirePermission('reports.sales.view')
  settings(@TenantCtx() ctx: TenantContext, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.service.settings(ctx, req.user);
  }

  @Patch('commission-settings')
  @RequireCapabilities('seller_settings.manage')
  @RequirePermission('pricing.price-entry.manage')
  updateSettings(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: UpdateCommissionSettingsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.updateSettings(ctx, dto, req.user);
  }

  @Patch(':id/commission-settings')
  @RequireCapabilities('seller_settings.manage')
  @RequirePermission('pricing.price-entry.manage')
  updateSellerSettings(
    @TenantCtx() ctx: TenantContext,
    @Param('id') sellerId: string,
    @Body() dto: UpdateSellerCommissionDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.updateSellerSettings(ctx, sellerId, dto, req.user);
  }

  @Get('periods')
  @RequireCapabilities('seller_reports.read')
  @RequirePermission('reports.sales.view')
  periods(@TenantCtx() ctx: TenantContext, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.service.periods(ctx, req.user);
  }

  @Post('periods/close')
  @RequireCapabilities('seller_periods.close')
  @RequirePermission('reports.sales.view-cost-margin')
  closePeriod(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CloseSellerPeriodDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.closePeriod(ctx, dto.from, dto.to, req.user);
  }
}
