import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { BundleService } from './bundle.service';
import { CreateBundleDto, ListBundlesDto, SupersedeBundleDto, UpdateBundleDraftDto } from './dto/bundle.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

/** WP-008 Phase D (BR-BND-1xx, Permission Matrix §16 `catalog.bundle.manage`). */
@Controller('bundles')
@RequireCapabilities('products.read')
export class BundleController {
  constructor(private readonly bundles: BundleService) {}

  @RequirePermission('catalog.product.view')
  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query() dto: ListBundlesDto) {
    return this.bundles.list(ctx, dto);
  }

  @RequirePermission('catalog.product.view')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.bundles.findOne(ctx, id);
  }

  @RequirePermission('catalog.bundle.manage')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateBundleDto, @Req() req: AuthedRequest) {
    return this.bundles.create(ctx, req.user.sub, dto);
  }

  @RequirePermission('catalog.bundle.manage')
  @Patch(':id')
  updateDraft(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateBundleDraftDto,
  ) {
    return this.bundles.updateDraft(ctx, id, dto);
  }

  @RequirePermission('catalog.bundle.manage')
  @Post(':id/activate')
  activate(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.bundles.activate(ctx, req.user.sub, id);
  }

  @RequirePermission('catalog.bundle.manage')
  @Post(':id/end')
  end(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Req() req: AuthedRequest) {
    return this.bundles.end(ctx, req.user.sub, id);
  }

  @RequirePermission('catalog.bundle.manage')
  @Post(':id/supersede')
  supersede(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: SupersedeBundleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.bundles.supersede(ctx, req.user.sub, id, dto);
  }
}
