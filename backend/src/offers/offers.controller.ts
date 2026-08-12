import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { OffersService } from './offers.service';
import { RequireCapabilities, Roles } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { ReviewOfferDto } from './dto/review-offer.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { resolveBranchScope } from '../auth/branch-access';

@Controller('offers')
@Roles('owner', 'branch_manager')
@RequireCapabilities('offers.manage')
export class OffersController {
  constructor(private svc: OffersService) {}

  @RequirePermission('promotion.view')
  @Get('suggestions')
  list(
    @TenantCtx() ctx: TenantContext,
    @Query('branch_id') branch_id: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.suggestions(ctx, req.user, resolveBranchScope(req.user, branch_id));
  }

  @RequirePermission('promotion.approve')
  @Post(':id/review')
  review(
    @TenantCtx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() dto: ReviewOfferDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.svc.review(ctx, id, dto.status, req.user);
  }
}
