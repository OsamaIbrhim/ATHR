import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { CreateProductTypeDto, UpdateProductTypeDto } from './dto/product-type.dto';
import { ProductTypesService } from './product-types.service';

@Controller('product-types')
export class ProductTypesController {
  constructor(private readonly svc: ProductTypesService) {}

  @RequirePermission('catalog.product.view')
  @Get()
  list(@TenantCtx() ctx: TenantContext) {
    return this.svc.list(ctx);
  }

  @RequirePermission('catalog.product-type.manage')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateProductTypeDto) {
    return this.svc.create(ctx, dto);
  }

  /** Also archives/restores a type via `is_active`. */
  @RequirePermission('catalog.product-type.manage')
  @Patch(':id')
  update(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() dto: UpdateProductTypeDto) {
    return this.svc.update(ctx, id, dto);
  }
}
