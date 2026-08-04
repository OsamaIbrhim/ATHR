import { Body, Controller, Get, Post } from '@nestjs/common';
import { BranchesService } from './branches.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { CreateBranchDto } from './dto/create-branch.dto';

@Controller('branches')
@RequireCapabilities('branches.manage')
export class BranchesController {
  constructor(private svc: BranchesService) {}

  @RequirePermission('location.view')
  @Get() list(@TenantCtx() ctx: TenantContext) {
    return this.svc.findAll(ctx);
  }

  @Roles('owner')
  @RequirePermission('location.create')
  @Post() create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateBranchDto) {
    return this.svc.create(ctx, dto);
  }
}
