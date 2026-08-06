import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { AssortmentService } from './assortment.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { ListAssortmentDto, UpsertAssortmentDto } from './dto/assortment.dto';

@Controller('assortment')
@RequireCapabilities('products.read')
export class AssortmentController {
  constructor(private svc: AssortmentService) {}

  @RequirePermission('catalog.assortment.view')
  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query() dto: ListAssortmentDto) {
    return this.svc.list(ctx, dto);
  }

  @Roles('owner', 'branch_manager', 'warehouse_manager')
  @RequireCapabilities('products.manage')
  @RequirePermission('catalog.assortment.manage')
  @Post()
  upsert(@TenantCtx() ctx: TenantContext, @Body() dto: UpsertAssortmentDto) {
    return this.svc.upsert(ctx, dto);
  }
}
