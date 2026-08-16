import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IDEMPOTENCY_KEY_HEADER } from '@athr/contracts';
import { RequireCapabilities } from '../auth/roles.guard';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { IdempotencyKeyGuard, RequiresIdempotencyKey } from '../common/http/idempotency-key.guard';
import { CouponService } from './coupon.service';
import { CreateCouponDto, ListCouponsDto, RedeemCouponDto, UpdateCouponDto } from './dto/coupon.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };
const IDEMPOTENCY_KEY_HEADER_NAME = IDEMPOTENCY_KEY_HEADER.toLowerCase();

/**
 * WP-008 Phase D (BR-CPN-2xx, Permission Matrix §19).
 *
 * `coupon.export-codes` intentionally gates NO route here — declared but
 * unwired in this phase, see `permission-catalog.ts`'s `COUPON_PERMISSIONS`
 * comment and the Phase D PR description.
 *
 * `coupon.code.view-sensitive` is not wired to `list`/`get` either: those
 * return `code_display` unconditionally today, since every role this phase
 * grants any `coupon.*` key to (`location_manager`, `tenant_owner`) also
 * holds `coupon.code.view-sensitive`. Narrowing the response by that key is
 * left to whoever grants a `coupon.*` view without it — flagged, not
 * silently assumed permanent.
 */
@Controller('coupons')
@RequireCapabilities('products.read')
export class CouponController {
  constructor(private readonly coupons: CouponService) {}

  @RequirePermission('coupon.usage.view')
  @Get()
  list(@TenantCtx() ctx: TenantContext, @Query() dto: ListCouponsDto) {
    return this.coupons.list(ctx, dto);
  }

  @RequirePermission('coupon.usage.view')
  @Get(':id')
  get(@TenantCtx() ctx: TenantContext, @Param('id') id: string) {
    return this.coupons.findOne(ctx, id);
  }

  @RequirePermission('coupon.code.generate')
  @Post()
  create(@TenantCtx() ctx: TenantContext, @Body() dto: CreateCouponDto, @Req() req: AuthedRequest) {
    return this.coupons.create(ctx, req.user.sub, dto);
  }

  @RequirePermission('coupon.campaign.create')
  @Patch(':id')
  update(@TenantCtx() ctx: TenantContext, @Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(ctx, id, dto);
  }

  /**
   * BR-CPN-204: the redemption itself is the first real consumer of
   * `IdempotencyKeyGuard`'s stored-result semantics (every other route that
   * carries `@RequiresIdempotencyKey()` today only validates header
   * presence/format — see that guard's own TODO). The header's value is read
   * here, not a body field, and passed straight through to
   * `CouponService.redeem` / `CouponRepository.redeem`, whose unique
   * constraint is the actual structural guarantee.
   *
   * GAP, flagged rather than silently resolved: Permission Matrix §19
   * declares no dedicated "perform a redemption" key — its six `coupon.*`
   * keys are all campaign/usage-management, not the act of redeeming one.
   * BR-CPN-203 ("الاستخدام النهائي عند Sale completion") frames redemption
   * as intrinsically part of completing a sale, so this endpoint is gated on
   * the existing `sales.sale.create` instead of inventing an ungoverned new
   * key or reusing a management key that doesn't fit (`coupon.redemption.
   * override` is for a supervisor overriding a limit, not for an ordinary
   * redemption). No Sale integration exists yet in this phase (WP-010's,
   * per the WP document's own "Blocks" line) — this is a standalone
   * redemption endpoint for this phase's own testing/proof purposes, not the
   * till checkout path. See the Phase D PR description.
   */
  @RequirePermission('sales.sale.create')
  @RequiresIdempotencyKey()
  @UseGuards(IdempotencyKeyGuard)
  @Post('redeem')
  redeem(@TenantCtx() ctx: TenantContext, @Body() dto: RedeemCouponDto, @Req() req: AuthedRequest) {
    const idempotencyKey = req.headers[IDEMPOTENCY_KEY_HEADER_NAME] as string;
    return this.coupons.redeem(ctx, req.user.sub, idempotencyKey, dto);
  }
}
