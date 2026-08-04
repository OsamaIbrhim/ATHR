import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Controller('suppliers')
@Roles('owner', 'branch_manager', 'warehouse_manager')
@RequireCapabilities('suppliers.manage')
export class SuppliersController {
  constructor(private svc: SuppliersService) {}

  @RequirePermission('supplier.view')
  @Get() list(@TenantCtx() ctx: TenantContext, @Query('q') q?: string) {
    return this.svc.findAll(ctx, q);
  }

  @RequirePermission('supplier.view')
  @Get('resolve/alias')
  resolve(@TenantCtx() ctx: TenantContext, @Query('name') name: string) {
    return this.svc.resolveAlias(ctx, name);
  }

  @RequirePermission('supplier.view')
  @Get(':id') get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.findOne(ctx, id);
  }

  @RequirePermission('supplier.create')
  @Post() create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateSupplierDto) {
    return this.svc.create(ctx, dto);
  }

  @RequirePermission('supplier.update')
  @Patch(':id') update(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.svc.update(ctx, id, dto);
  }

  @RequirePermission('supplier.archive')
  @Delete(':id') remove(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }
}
