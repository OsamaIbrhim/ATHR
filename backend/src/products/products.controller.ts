import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ProductsService } from './products.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import { CreateProductDto, UpdateVariantDto } from './dto/product.dto';
import { ListProductsDto } from './dto/list-products.dto';

@Controller('products')
@RequireCapabilities('products.read')
export class ProductsController {
  constructor(private svc: ProductsService) {}

  @RequirePermission('catalog.product.view')
  @Get()
  list(
    @TenantCtx() ctx: TenantContext,
    @Query() dto: ListProductsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const canReadCost = ['owner', 'branch_manager', 'warehouse_manager'].includes(req.user.role);
    const branch = resolveBranchScope(req.user, dto.branch_id, ['owner', 'warehouse_manager']);
    return this.svc.list(ctx, dto.q || '', dto.page, dto.page_size, branch, canReadCost);
  }

  @RequirePermission('catalog.product.view')
  @Get('search')
  search(
    @TenantCtx() ctx: TenantContext,
    @Query('q') q: string,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const canReadCost = ['owner', 'branch_manager', 'warehouse_manager'].includes(req.user.role);
    const effectiveBranch = resolveBranchScope(req.user, branch_id, ['owner', 'warehouse_manager']);
    return this.svc.search(ctx, q || '', effectiveBranch, canReadCost);
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequireCapabilities('products.manage')
  @RequirePermission('catalog.product.create')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateProductDto) {
    return this.svc.createProduct(ctx, dto);
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequireCapabilities('products.manage')
  @RequirePermission('catalog.variant.update')
  @Patch('variants/:id')
  updateVariant(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.svc.updateVariant(ctx, id, dto);
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequireCapabilities('products.manage')
  @RequirePermission('catalog.product.archive')
  @Delete('variants/:id')
  removeVariant(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.removeVariant(ctx, id);
  }
}
