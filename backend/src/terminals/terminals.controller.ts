import { Body, Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CreateTerminalEnrollmentDto, DecommissionTerminalDto, EnrollTerminalDto, TerminalHeartbeatDto, UpdateTerminalDto } from './dto/terminal.dto';
import { TerminalsService } from './terminals.service';
import { Public } from '../auth/public.decorator';
import { PosProtocolGuard } from '../updates/pos-protocol.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';

@Controller('terminals')
export class TerminalsController {
  constructor(private service: TerminalsService) {}

  @Roles('owner', 'branch_manager')
  @RequireCapabilities('terminals.manage')
  @RequirePermission('terminal.provision')
  @Post('enrollment-codes')
  createEnrollment(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: CreateTerminalEnrollmentDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.createEnrollment(ctx, dto, req.user);
  }

  @Public()
  @Post('enroll')
  enroll(@Body() dto: EnrollTerminalDto) {
    return this.service.enroll(dto);
  }

  @Roles('branch_manager', 'cashier')
  @RequireCapabilities('sales.create')
  @UseGuards(new PosProtocolGuard())
  @RequirePermission('terminal.view-health')
  @Post('heartbeat')
  heartbeat(
    @Body() dto: TerminalHeartbeatDto,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.heartbeat(dto, deviceToken, req.user);
  }

  @Roles('branch_manager')
  @RequireCapabilities('terminals.manage')
  @UseGuards(new PosProtocolGuard())
  @RequirePermission('terminal.retire')
  @Post('self-decommission')
  selfDecommission(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: DecommissionTerminalDto,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.selfDecommission(ctx, dto, deviceToken, req.user);
  }

  @Roles('owner', 'branch_manager')
  @RequireCapabilities('terminals.read')
  @RequirePermission('terminal.view')
  @Get()
  list(
    @TenantCtx() ctx: TenantContext,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.list(ctx, req.user);
  }

  @Roles('owner', 'branch_manager')
  @RequireCapabilities('terminals.manage')
  @RequirePermission('terminal.block')
  @Patch(':id')
  update(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateTerminalDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.service.update(ctx, id, dto, req.user);
  }
}
