import { Global, Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';
import { LimitService } from './limit.service';

/** Test doubles for services whose behaviour is not under test: nothing is ever limited or restricted. */
export const unlimited = { assertCanCreate: async () => undefined } as unknown as LimitService;

export const fullAccess = {
  resolve: async () => ({ mode: 'full', planCode: 'business', features: new Set(), limits: {} }),
  assertCanWrite: async () => undefined,
  invalidate: () => undefined,
} as unknown as EntitlementService;

/** For Nest testing modules that load a module which depends on the (global) entitlement services. */
@Global()
@Module({
  providers: [
    { provide: EntitlementService, useValue: fullAccess },
    { provide: LimitService, useValue: unlimited },
  ],
  exports: [EntitlementService, LimitService],
})
export class StubEntitlementsModule {}
