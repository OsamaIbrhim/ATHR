import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ReportsService } from './reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';

@Controller('reports')
@Roles('owner', 'branch_manager')
@RequireCapabilities('reports.read')
export class ReportsController {
  constructor(private svc: ReportsService, private notify: NotificationsService) {}

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequirePermission('reports.sales.view')
  @Get('sales') sales(
    @TenantCtx() ctx: TenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.sales(
      ctx,
      from,
      to,
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequirePermission('reports.sales.view')
  @Get('best-sellers') best(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.bestSellers(
      ctx,
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequirePermission('reports.sales.view-cost-margin')
  @Get('profit-by-item') profitByItem(
    @TenantCtx() ctx: TenantContext,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.profitByItem(
      ctx,
      from,
      to,
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequirePermission('reports.inventory.view-cost')
  @Get('inventory-valuation') inventoryValuation(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.inventoryValuation(
      ctx,
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }

  @RequireCapabilities('reports.send')
  @RequirePermission('reports.sales.export')
  @Post('send') async send(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: { from: string, to: string, branch_id?: string, channels: string[] },
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const report = await this.svc.sales(ctx, dto.from, dto.to, resolveBranchScope(req.user, dto.branch_id));
    return this.notify.sendReport(ctx, report, dto.channels || ['email']);
  }
}
