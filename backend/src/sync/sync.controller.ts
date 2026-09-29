import { BadRequestException, Controller, Get, Headers, NotImplementedException, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SyncService } from './sync.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { canAccessAllBranches, resolveBranchScope } from '../auth/branch-access';
import { TerminalsService } from '../terminals/terminals.service';
import { PosProtocolGuard } from '../updates/pos-protocol.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
@Controller('sync')
export class SyncController {
  constructor(private svc: SyncService, private terminals: TerminalsService) {}
  @RequirePermission('sales.sale.create')
  @Post('push') push() {
    throw new NotImplementedException('Batch push is disabled; use the idempotent command endpoints');
  }
  @RequirePermission('sales.sale.create', 'catalog.product.view')
  @Get('pull')
  @UseGuards(new PosProtocolGuard())
  async pull(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string,
    @Query('cursor') cursor: string | undefined,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const effectiveBranch = resolveBranchScope(req.user, branch_id);
    if (!effectiveBranch) throw new BadRequestException('branch_id is required');
    // Tenant-wide users may call this endpoint for support/performance diagnostics. Every
    // branch-bound POS user must also prove that the physical till is enrolled.
    if (!canAccessAllBranches(req.user)) await this.terminals.authenticate(deviceId, deviceToken, req.user);
    return this.svc.pull(ctx, effectiveBranch, cursor);
  }
}
