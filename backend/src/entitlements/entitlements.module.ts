import { Global, Module } from '@nestjs/common';
import { EntitlementGuard } from './entitlement.guard';
import { EntitlementService } from './entitlement.service';
import { LimitService } from './limit.service';
import { PlatformController } from './platform/platform.controller';
import { PlatformService } from './platform/platform.service';
import { SubscriptionController } from './subscription.controller';

/**
 * Plans, subscriptions and what they allow (ADR-0005 Entitlement and Limit).
 * Global because the tenant guard and every creation point consult it.
 */
@Global()
@Module({
  controllers: [SubscriptionController, PlatformController],
  providers: [EntitlementService, LimitService, EntitlementGuard, PlatformService],
  exports: [EntitlementService, LimitService, EntitlementGuard],
})
export class EntitlementsModule {}
