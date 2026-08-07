import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import type { MembershipRole } from '@prisma/client';
import { OverridesService } from './overrides.service';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { ApplyOverrideDto, PriceOverridePolicyDto } from './dto/override.dto';
import { ApplyDiscountDto } from './dto/discount.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

/** WP-008 Phase B (BR-OVP-1xx, BR-DSC-2xx): manual override and discount as distinct, audited entities. */
@Controller('pricing')
@RequireCapabilities('products.read')
export class OverridesController {
  constructor(private readonly svc: OverridesService) {}

  @RequirePermission('pricing.floor.configure')
  @Put('override-policy/:role')
  savePolicy(
    @TenantCtx() ctx: TenantContext,
    @Param('role') role: MembershipRole,
    @Body() dto: PriceOverridePolicyDto,
  ) {
    return this.svc.savePolicy(ctx, role, dto);
  }

  @RequirePermission('pricing.manual-override.apply')
  @Post('overrides')
  applyOverride(@TenantCtx() ctx: TenantContext, @Body() dto: ApplyOverrideDto, @Req() req: AuthedRequest) {
    return this.svc.applyOverride(ctx, req.user, dto);
  }

  @RequirePermission('pricing.manual-override.approve')
  @Get('overrides')
  listOverrides(@TenantCtx() ctx: TenantContext, @Query('variant_id') variantId?: string) {
    return this.svc.listOverrides(ctx, variantId);
  }

  @RequirePermission('pricing.manual-override.apply')
  @Post('discounts')
  applyDiscount(@TenantCtx() ctx: TenantContext, @Body() dto: ApplyDiscountDto, @Req() req: AuthedRequest) {
    return this.svc.applyDiscount(ctx, req.user, dto);
  }

  @RequirePermission('pricing.manual-override.approve')
  @Get('discounts')
  listDiscounts(@TenantCtx() ctx: TenantContext, @Query('variant_id') variantId?: string) {
    return this.svc.listDiscounts(ctx, variantId);
  }
}
