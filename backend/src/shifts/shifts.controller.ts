import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ShiftsService } from './shifts.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';
import { CloseShiftDto, OpenShiftDto } from './dto/shift.dto';
import { TerminalsService } from '../terminals/terminals.service';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';

@Controller('shifts')
@Roles('owner', 'branch_manager', 'cashier')
@RequireCapabilities('shifts.manage')
export class ShiftsController {
  constructor(
    private svc: ShiftsService,
    private terminals: TerminalsService,
  ) {}

  @RequirePermission('shift.view')
  @Get()
  list(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.list(ctx, resolveBranchScope(req.user, branch_id));
  }

  @RequirePermission('shift.view')
  @Get('current')
  current(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const effectiveBranch = resolveBranchScope(req.user, branch_id);
    return effectiveBranch ? this.svc.current(ctx, effectiveBranch) : null;
  }

  @RequirePermission('shift.open-own')
  @Post('open')
  open(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: OpenShiftDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.open(ctx, dto.branch_id, req.user, dto.opening_cash || 0);
  }

  @RequirePermission('shift.view')
  @Post(':id/offline-context')
  @Roles('branch_manager', 'cashier')
  async offlineContext(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const terminal = await this.terminals.authenticate(
      deviceId,
      deviceToken,
      req.user,
    );
    return this.svc.issueOfflineContext(ctx, id, req.user, terminal);
  }

  @RequirePermission('shift.close-own')
  @Post(':id/close')
  close(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.close(ctx, id, req.user, dto.closing_cash);
  }
}
