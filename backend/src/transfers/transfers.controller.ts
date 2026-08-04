import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { TransfersService } from './transfers.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import {
  CancelTransferDto,
  CreateTransferDto,
  ReceiveTransferDto,
  TransferCommandDto,
} from './dto/transfer.dto';

@Controller('transfers')
@Roles('owner', 'branch_manager', 'warehouse_manager')
@RequireCapabilities('transfers.manage')
export class TransfersController {
  constructor(private svc: TransfersService) {}

  @RequirePermission('transfer.view')
  @Get()
  list(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.list(
      ctx,
      resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']),
    );
  }

  @RequirePermission('transfer.view')
  @Get('reconciliation/in-transit')
  reconcile(
    @TenantCtx() ctx: TenantContext,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.reconcileInTransit(ctx, req.user);
  }

  @RequirePermission('transfer.view')
  @Get(':id')
  get(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.get(ctx, id, req.user);
  }

  @RequirePermission('transfer.create')
  @Post()
  create(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CreateTransferDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.create(ctx, dto, req.user);
  }

  @RequirePermission('transfer.ship')
  @Post(':id/ship')
  ship(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: TransferCommandDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.ship(ctx, id, dto || {}, req.user);
  }

  @RequirePermission('transfer.receive')
  @Post(':id/receive')
  receive(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ReceiveTransferDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.receive(ctx, id, dto || {}, req.user);
  }

  @RequirePermission('transfer.cancel-before-shipment')
  @Post(':id/cancel')
  cancel(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: CancelTransferDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.cancel(ctx, id, dto, req.user);
  }
}
