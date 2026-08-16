import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { PromotionService } from './promotion.service';
import { CreatePromotionDto, ListPromotionsDto, UpdatePromotionDraftDto } from './dto/promotion.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

/**
 * WP-008 Phase D (BR-PMT-1xx, Permission Matrix §19).
 *
 * Every route is gated on the §19 key the Matrix names for that operation.
 * `promotion.simulate` intentionally gates NO route here — declared but
 * unwired in this phase, same posture Phase C used for
 * `tax.calculation.override`/`tax.export`; see the Phase D PR description.
 * Promotion evaluation reaches a caller through `POST /pricing/calculate`
 * instead (gated by the pre-existing `pricing.price-book.view`), not through
 * a dedicated simulate endpoint.
 */
@Controller('promotions')
@RequireCapabilities('products.read')
export class PromotionController {
  constructor(private readonly promotions: PromotionService) {}

  @RequirePermission('promotion.view')
  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query() dto: ListPromotionsDto) {
    return this.promotions.list(ctx, dto);
  }

  @RequirePermission('promotion.view')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.promotions.findOne(ctx, id);
  }

  @RequirePermission('promotion.create')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreatePromotionDto, @Req() req: AuthedRequest) {
    return this.promotions.create(ctx, req.user.sub, dto);
  }

  @RequirePermission('promotion.update-draft')
  @Patch(':id')
  updateDraft(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdatePromotionDraftDto,
  ) {
    return this.promotions.updateDraft(ctx, id, dto);
  }

  @RequirePermission('promotion.submit')
  @Post(':id/submit')
  submit(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.promotions.submit(ctx, req.user.sub, id);
  }

  @RequirePermission('promotion.approve')
  @Post(':id/approve')
  approve(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.promotions.approve(ctx, req.user.sub, id);
  }

  @RequirePermission('promotion.schedule')
  @Post(':id/schedule')
  schedule(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.promotions.schedule(ctx, req.user.sub, id);
  }

  @RequirePermission('promotion.activate')
  @Post(':id/activate')
  activate(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.promotions.activate(ctx, req.user.sub, id);
  }

  @RequirePermission('promotion.pause')
  @Post(':id/pause')
  pause(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.promotions.pause(ctx, req.user.sub, id);
  }

  @RequirePermission('promotion.resume')
  @Post(':id/resume')
  resume(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.promotions.resume(ctx, req.user.sub, id);
  }

  @RequirePermission('promotion.end')
  @Post(':id/end')
  end(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.promotions.end(ctx, req.user.sub, id);
  }

  // Matrix §19 declares no dedicated `promotion.cancel` key for the
  // `cancelled` state BR-PMT-100 lists — reusing `promotion.end` here is a
  // deliberate, flagged discrepancy (see `PromotionService`'s class comment
  // and the Phase D PR description), not a silent assumption.
  @RequirePermission('promotion.end')
  @Post(':id/cancel')
  cancel(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.promotions.cancel(ctx, req.user.sub, id);
  }
}
