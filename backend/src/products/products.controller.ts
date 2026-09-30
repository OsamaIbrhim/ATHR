import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ProductsService } from './products.service';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import {
  BarcodeDto,
  CreateProductDto,
  UpdateBarcodeDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantInputDto,
} from './dto/product.dto';
import { ListProductsDto } from './dto/list-products.dto';

@Controller('products')
export class ProductsController {
  constructor(private svc: ProductsService) {}

  @RequirePermission('catalog.product.view')
  @Get()
  list(
    @TenantCtx() ctx: TenantContext,
    @Query() dto: ListProductsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const canReadCost = req.user.permissions.has('catalog.product.view-cost-sensitive');
    const branch = resolveBranchScope(req.user, dto.branch_id);
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
    const canReadCost = req.user.permissions.has('catalog.product.view-cost-sensitive');
    const effectiveBranch = resolveBranchScope(req.user, branch_id);
    return this.svc.search(ctx, q || '', effectiveBranch, canReadCost);
  }

  @RequirePermission('catalog.product.create')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateProductDto) {
    return this.svc.createProduct(ctx, dto);
  }

  @RequirePermission('catalog.product.view')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.getProduct(ctx, id);
  }

  @RequirePermission('catalog.product.update')
  @Patch(':id')
  update(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.svc.updateProduct(ctx, id, dto);
  }

  @RequirePermission('catalog.variant.create')
  @Post(':id/variants')
  addVariant(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() dto: VariantInputDto) {
    return this.svc.addVariant(ctx, id, dto);
  }

  @RequirePermission('catalog.variant.update')
  @Post('variants/:id/barcodes')
  addBarcode(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() dto: BarcodeDto) {
    return this.svc.addBarcode(ctx, id, dto);
  }

  @RequirePermission('catalog.variant.update')
  @Patch('barcodes/:id')
  updateBarcode(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() dto: UpdateBarcodeDto) {
    return this.svc.updateBarcode(ctx, id, dto);
  }

  @RequirePermission('catalog.variant.update')
  @Delete('barcodes/:id')
  removeBarcode(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.removeBarcode(ctx, id);
  }

  @RequirePermission('catalog.variant.update')
  @Patch('variants/:id')
  updateVariant(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.svc.updateVariant(ctx, id, dto);
  }

  @RequirePermission('catalog.product.archive')
  @Delete('variants/:id')
  removeVariant(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.removeVariant(ctx, id);
  }
}
