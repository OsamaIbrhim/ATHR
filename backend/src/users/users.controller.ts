import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';

@Controller('users')
@RequireCapabilities('users.manage')
export class UsersController {
  constructor(private svc: UsersService) {}

  @RequirePermission('tenant.membership.view')
  @Get() list(@TenantCtx() ctx: TenantContext, @Req() req: Request & { user: AuthenticatedUser }) {
    return this.svc.findAll(ctx, req.user);
  }

  @RequirePermission('membership.invite')
  @Post() create(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CreateUserDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.create(ctx, dto, req.user);
  }

  @RequirePermission('membership.role.assign')
  @Patch(':id/permissions') updatePermissions(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateUserPermissionsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.updatePermissions(ctx, id, dto, req.user);
  }
}
