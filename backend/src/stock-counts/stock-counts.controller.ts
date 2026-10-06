import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { StockCountsService } from './stock-counts.service';
import { StockCountScansService } from './stock-count-scans.service';
import { StockCountsReadService } from './stock-counts.read.service';
import {
  CancelCountDto,
  CountEntriesDto,
  ListCountsDto,
  PostCountDto,
  RecentEntriesDto,
  ReviewCountDto,
  ScopeSizeDto,
  StartCountDto,
} from './dto/stock-count.dto';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';

type Req_ = Request & { user: AuthenticatedUser };

/**
 * Stock counts. Counting (scans, the counter's own list) needs
 * inventory.adjustment.request; starting, reviewing, resetting an item and
 * cancelling need request and approve; posting needs inventory.adjustment.post.
 */
@Controller('inventory/counts')
export class StockCountsController {
  constructor(
    private readonly svc: StockCountsService,
    private readonly scans: StockCountScansService,
    private readonly reads: StockCountsReadService,
  ) {}

  @RequirePermission('inventory.adjustment.request')
  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query() query: ListCountsDto, @Req() req: Req_) {
    return this.reads.list(ctx, query, req.user);
  }

  @RequirePermission('inventory.adjustment.request')
  @Get('scope-size')
  scopeSize(@TenantCtx() ctx: TenantContext, @Query() query: ScopeSizeDto, @Req() req: Req_) {
    return this.reads.scopeSize(ctx, query, req.user);
  }

  @RequirePermission('inventory.adjustment.request', 'inventory.adjustment.approve')
  @Post()
  start(@TenantCtx() ctx: TenantContext, @Body() dto: StartCountDto, @Req() req: Req_) {
    return this.svc.start(ctx, dto, req.user);
  }

  @RequirePermission('inventory.adjustment.request')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Req_) {
    return this.reads.get(ctx, id, req.user);
  }

  @RequirePermission('inventory.adjustment.request', 'inventory.adjustment.approve')
  @Get(':id/review')
  review(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReviewCountDto,
    @Req() req: Req_,
  ) {
    return this.reads.review(ctx, id, query, req.user);
  }

  @RequirePermission('inventory.adjustment.request')
  @Get(':id/recent')
  recent(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RecentEntriesDto,
    @Req() req: Req_,
  ) {
    return this.reads.recent(ctx, id, query, req.user);
  }

  @RequirePermission('inventory.adjustment.request')
  @Post(':id/entries')
  @HttpCode(200)
  record(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CountEntriesDto,
    @Req() req: Req_,
  ) {
    return this.scans.record(ctx, id, dto, req.user);
  }

  @RequirePermission('inventory.adjustment.request', 'inventory.adjustment.approve')
  @Delete(':id/lines/:variantId')
  resetLine(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Req() req: Req_,
  ) {
    return this.scans.resetLine(ctx, id, variantId, req.user);
  }

  @RequirePermission('inventory.adjustment.post')
  @Post(':id/post')
  @HttpCode(200)
  post(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostCountDto,
    @Req() req: Req_,
  ) {
    return this.svc.post(ctx, id, dto ?? {}, req.user);
  }

  @RequirePermission('inventory.adjustment.request', 'inventory.adjustment.approve')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @TenantCtx() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCountDto,
    @Req() req: Req_,
  ) {
    return this.svc.cancel(ctx, id, dto ?? {}, req.user);
  }
}
