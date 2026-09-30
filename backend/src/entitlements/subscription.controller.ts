import { Controller, Get } from '@nestjs/common';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
import { AllowInAnyAccessMode } from './entitlement.decorators';
import { EntitlementService } from './entitlement.service';
import { LimitService } from './limit.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly limits: LimitService,
  ) {}

  /** The caller's own tenant only: plan, mode, dates and usage against limits (admin banner, POS). */
  @AllowInAnyAccessMode()
  @Get('status')
  async status(@TenantCtx() ctx: TenantContext) {
    const access = await this.entitlements.resolve(ctx.tenantId);
    return {
      mode: access.mode,
      status: access.status,
      plan: access.planCode && access.planName ? { code: access.planCode, name_ar: access.planName.ar, name_en: access.planName.en } : null,
      trial_ends_at: access.trialEndsAt,
      current_period_end: access.periodEnd,
      grace_until: access.graceUntil,
      restricted_since: access.restrictedSince,
      features: [...access.features],
      limits: access.limits,
      usage: await this.limits.usage(ctx.tenantId),
    };
  }
}
