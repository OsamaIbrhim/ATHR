import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { InventoryService } from './inventory.service';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { resolveBranchScope } from '../auth/branch-access';

@Controller('inventory')
export class InventoryController {
  constructor(private svc: InventoryService) {}

  @RequirePermission('inventory.position.view')
  @Get('lookup')
  lookup(
    @TenantCtx() ctx: TenantContext,
    @Query('variant_id') variant_id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.lookup(ctx, variant_id, resolveBranchScope(req.user));
  }

  @RequirePermission('inventory.movement.view')
  @Get('movements')
  movements(
    @TenantCtx() ctx: TenantContext,
    @Query('variant_id') variant_id: string,
    @Query('branch_id') branch_id: string | undefined,
    @Query('take') take: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const effectiveBranch = resolveBranchScope(req.user, branch_id);
    const parsedTake = Number(take || 100);
    return this.svc.movements(
      ctx,
      variant_id,
      effectiveBranch,
      Number.isInteger(parsedTake) ? parsedTake : 100,
    );
  }

  @RequirePermission('inventory.movement.view')
  @Get('reconciliation')
  reconciliation(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.reconcile(
      ctx,
      resolveBranchScope(req.user, branch_id),
    );
  }
}
