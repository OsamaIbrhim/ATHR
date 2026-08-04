import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { CreateCustomerDto, SetCustomerVipDto, UpdateCustomerDto } from './dto/customer.dto';

@Controller('customers')
@RequireCapabilities('customers.read')
export class CustomersController {
  constructor(private svc: CustomersService) {}

  @RequirePermission('customer.profile.search')
  @Get() list(@TenantCtx() ctx: TenantContext, @Query('q') q?: string) {
    return q && q.startsWith('01') ? this.svc.searchByPhone(ctx, q) : this.svc.findAll(ctx, q);
  }

  @RequirePermission('customer.profile.search')
  @Get('lookup') byPhone(@TenantCtx() ctx: TenantContext, @Query('phone') phone: string) {
    return this.svc.searchByPhone(ctx, phone);
  }

  @RequirePermission('customer.profile.view')
  @Get('loyalty') loyalty(@TenantCtx() ctx: TenantContext, @Query('phone') phone: string) {
    return this.svc.loyaltyStatus(ctx, phone);
  }

  @RequirePermission('customer.profile.view')
  @Get(':id') get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.findOne(ctx, id);
  }

  @RequirePermission('customer.profile.create')
  @Post() create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateCustomerDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles('owner', 'branch_manager')
  @RequireCapabilities('customers.manage')
  @RequirePermission('customer.profile.update')
  @Patch(':id') update(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.svc.update(ctx, id, dto);
  }

  @Roles('owner', 'branch_manager')
  @RequireCapabilities('customers.manage')
  @RequirePermission('customer.profile.update')
  @Post(':id/vip') setVip(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: SetCustomerVipDto,
  ) {
    return this.svc.setVip(ctx, id, dto.is_vip, dto.vip_price_tier);
  }

  @Roles('owner', 'branch_manager')
  @RequireCapabilities('customers.manage')
  @RequirePermission('customer.profile.update')
  @Delete(':id') remove(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }
}
