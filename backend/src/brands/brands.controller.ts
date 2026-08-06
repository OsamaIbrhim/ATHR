import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@Controller('brands')
@RequireCapabilities('products.read')
export class BrandsController {
  constructor(private svc: BrandsService) {}

  @RequirePermission('catalog.product.view')
  @Get()
  list(
    @TenantCtx() ctx: TenantContext,
    @Query('q') q?: string,
    @Query('include_archived') includeArchived?: string,
  ) {
    return this.svc.findAll(ctx, q, includeArchived === 'true');
  }

  @RequirePermission('catalog.product.view')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.findOne(ctx, id);
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequireCapabilities('products.manage')
  @RequirePermission('catalog.brand.manage')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateBrandDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequireCapabilities('products.manage')
  @RequirePermission('catalog.brand.manage')
  @Patch(':id')
  update(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.svc.update(ctx, id, dto);
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequireCapabilities('products.manage')
  @RequirePermission('catalog.brand.manage')
  @Delete(':id')
  archive(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.archive(ctx, id);
  }
}
