import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { AdjustmentsService } from './adjustments.service';
import { AdjustmentsReadService } from './adjustments.read.service';
import { ADJUSTMENT_REASONS } from './adjustment-reasons';
import {
  CancelAdjustmentDto,
  CreateAdjustmentDto,
  ListAdjustmentsDto,
  UpdateAdjustmentDto,
} from './dto/adjustment.dto';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type Req_ = Request & { user: AuthenticatedUser };

/**
 * The adjustment document. Each step has its own existing permission key:
 * request (create/edit a draft), approve, post; cancelling needs request or
 * approve (checked by the service, which accepts either).
 */
@Controller('inventory/adjustments')
export class AdjustmentsController {
  constructor(
    private readonly svc: AdjustmentsService,
    private readonly reads: AdjustmentsReadService,
  ) {}

  @RequirePermission('inventory.movement.view')
  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query() query: ListAdjustmentsDto, @Req() req: Req_) {
    return this.reads.list(ctx, query, req.user);
  }

  @RequirePermission('inventory.movement.view')
  @Get('reasons')
  reasons() {
    return { items: ADJUSTMENT_REASONS };
  }

  @RequirePermission('inventory.movement.view')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Req_) {
    return this.reads.get(ctx, id, req.user);
  }

  @RequirePermission('inventory.adjustment.request')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateAdjustmentDto, @Req() req: Req_) {
    return this.svc.create(ctx, dto, req.user);
  }

  @RequirePermission('inventory.adjustment.request')
  @Put(':id')
  update(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdjustmentDto,
    @Req() req: Req_,
  ) {
    return this.svc.update(ctx, id, dto, req.user);
  }

  @RequirePermission('inventory.adjustment.approve')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@TenantCtx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Req_) {
    return this.svc.approve(ctx, id, req.user);
  }

  @RequirePermission('inventory.adjustment.post')
  @Post(':id/post')
  @HttpCode(200)
  post(@TenantCtx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Req_) {
    return this.svc.post(ctx, id, req.user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAdjustmentDto,
    @Req() req: Req_,
  ) {
    return this.svc.cancel(ctx, id, dto ?? {}, req.user);
  }
}
