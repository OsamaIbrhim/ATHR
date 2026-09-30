import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ProductImportService } from './product-import.service';
import { ImportProductsDto } from './dto/product-import.dto';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';

@Controller('products/import')
export class ProductImportController {
  constructor(private readonly svc: ProductImportService) {}

  /**
   * One chunk of an import (up to 2000 rows). `dry_run: true` validates and
   * reports per row without writing; otherwise the rows are created. The service
   * also requires pricing.price-entry.manage + pricing.price-book.activate (the
   * prices go live) and, for opening quantities, inventory.adjustment.post.
   */
  @RequirePermission('catalog.product.create', 'catalog.variant.create')
  @Post()
  @HttpCode(200)
  import(@TenantCtx() ctx: TenantContext, @Body() dto: ImportProductsDto, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.import(ctx, dto, req.user);
  }
}
