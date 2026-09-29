import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { TenantContextGuard } from '../identity/tenant-context.guard';
import { SalesController } from '../sales/sales.controller';
import { PromotionController } from '../promotions/promotion.controller';
import { CouponController } from '../promotions/coupon.controller';
import { BundleController } from '../promotions/bundle.controller';
import { UomController } from '../uom/uom.controller';
import { TerminalsController } from '../terminals/terminals.controller';
import { AuthController } from '../auth/auth.controller';
import { actorFor } from '../auth/testing/actors';
import { contextFor, TENANT_A, TENANT_B } from '../identity/testing/cross-tenant-harness';
import { ANY_ACCESS_MODE_KEY, PLATFORM_ROUTE_KEY, REQUIRED_FEATURE_KEY } from './entitlement.decorators';
import { EntitlementGuard } from './entitlement.guard';
import { EntitlementService, computeAccess } from './entitlement.service';
import { PlatformAdminGuard } from './platform/platform-admin.guard';
import { PlatformController } from './platform/platform.controller';
import { PlatformService } from './platform/platform.service';
import { SubscriptionController } from './subscription.controller';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-01T12:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

function plan(over: Record<string, unknown> = {}) {
  return {
    id: 'plan-1', code: 'pro', name_ar: 'برو', name_en: 'Pro',
    features: ['promotions'], limits: { branches: 3, users: null },
    updated_at: new Date('2026-01-01'), ...over,
  };
}

function subscription(over: Record<string, unknown> = {}, planOver: Record<string, unknown> = {}) {
  return {
    id: 'sub-1', tenant_id: TENANT_A, plan_id: 'plan-1', status: 'active',
    status_changed_at: new Date('2026-01-01'), trial_ends_at: null, current_period_end: at(10),
    notes: null, updated_by: null, created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
    plan: plan(planOver), ...over,
  } as any;
}

describe('access mode computation', () => {
  it('trial and active are full up to and including the period end', () => {
    expect(computeAccess(subscription({ status: 'trial', trial_ends_at: at(3), current_period_end: null }), NOW, 7).mode).toBe('full');
    expect(computeAccess(subscription({ current_period_end: at(10) }), NOW, 7).mode).toBe('full');
    expect(computeAccess(subscription({ current_period_end: NOW }), NOW, 7).mode).toBe('full');
  });

  it('a subscription with no end date never expires', () => {
    expect(computeAccess(subscription({ current_period_end: null }), NOW, 7).mode).toBe('full');
  });

  it('is grace (full access plus a deadline) for N days after the end, then read_only', () => {
    const justEnded = computeAccess(subscription({ current_period_end: at(-1) }), NOW, 7);
    expect(justEnded.mode).toBe('grace');
    expect(justEnded.graceUntil).toEqual(at(6));

    expect(computeAccess(subscription({ current_period_end: at(-7) }), NOW, 7).mode).toBe('grace');

    const over = computeAccess(subscription({ current_period_end: at(-8) }), NOW, 7);
    expect(over.mode).toBe('read_only');
    expect(over.restrictedSince).toEqual(at(-1));
  });

  it('the grace length is configurable, including none', () => {
    expect(computeAccess(subscription({ current_period_end: at(-1) }), NOW, 0).mode).toBe('read_only');
    expect(computeAccess(subscription({ current_period_end: at(-10) }), NOW, 30).mode).toBe('grace');
  });

  it('a trial is judged by trial_ends_at, not by the period end', () => {
    const trial = subscription({ status: 'trial', trial_ends_at: at(-20), current_period_end: at(100) });
    expect(computeAccess(trial, NOW, 7).mode).toBe('read_only');
  });

  it('suspended and cancelled are suspended; expired is read_only', () => {
    const since = new Date('2026-09-20');
    expect(computeAccess(subscription({ status: 'suspended', status_changed_at: since }), NOW, 7))
      .toMatchObject({ mode: 'suspended', restrictedSince: since });
    expect(computeAccess(subscription({ status: 'cancelled' }), NOW, 7).mode).toBe('suspended');
    expect(computeAccess(subscription({ status: 'expired' }), NOW, 7).mode).toBe('read_only');
  });

  it('no subscription at all is suspended (fail closed)', () => {
    expect(computeAccess(null, NOW, 7)).toMatchObject({ mode: 'suspended', planCode: null });
  });

  it('exposes the plan features and limits; a missing or null limit is unlimited', () => {
    const access = computeAccess(subscription(), NOW, 7);
    expect(access.features.has('promotions')).toBe(true);
    expect(access.features.has('uom')).toBe(false);
    expect(access.limits).toEqual({ branches: 3 });
    expect(access.limits.users).toBeUndefined();
  });
});

describe('EntitlementService cache', () => {
  function service(rows: any[]) {
    const findUnique = jest.fn(async () => rows[0]);
    return { findUnique, service: new EntitlementService({ subscription: { findUnique } } as any) };
  }

  it('reads the subscription once within the TTL and again after invalidation', async () => {
    const { findUnique, service: entitlements } = service([subscription()]);
    await entitlements.resolve(TENANT_A);
    await entitlements.resolve(TENANT_A);
    expect(findUnique).toHaveBeenCalledTimes(1);
    entitlements.invalidate(TENANT_A);
    await entitlements.resolve(TENANT_A);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('the mode follows the clock even while the row is cached', async () => {
    const { service: entitlements } = service([subscription({ current_period_end: at(1) })]);
    expect((await entitlements.resolve(TENANT_A, NOW)).mode).toBe('full');
    expect((await entitlements.resolve(TENANT_A, at(3))).mode).toBe('grace');
  });

  it('a platform plan change invalidates the cache so it applies at once', async () => {
    const rows = [subscription()];
    const prisma: any = {
      subscription: {
        findUnique: jest.fn(async () => rows[0]),
        update: jest.fn(async ({ data }: any) => (rows[0] = { ...rows[0], ...data, plan: plan({ code: 'business', features: ['promotions', 'uom'] }) })),
      },
      plan: { findUnique: jest.fn(async () => plan({ id: 'plan-2', code: 'business', is_active: true })) },
      subscriptionEvent: { create: jest.fn() },
      $transaction: async (callback: any) => callback(prisma),
    };
    const entitlements = new EntitlementService(prisma);
    const platform = new PlatformService(prisma, entitlements, {} as any);

    expect((await entitlements.resolve(TENANT_A)).planCode).toBe('pro');
    await platform.changePlan(TENANT_A, 'business', 'admin-1', 'upgrade');
    expect((await entitlements.resolve(TENANT_A)).planCode).toBe('business');
    expect(prisma.subscriptionEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'plan_changed', from_plan_code: 'pro', to_plan_code: 'business', actor_user_id: 'admin-1' }),
    });
  });

  it('a plan edit invalidates every tenant', async () => {
    const { findUnique, service: entitlements } = service([subscription()]);
    const prisma: any = {
      plan: { findUnique: async () => ({ id: 'plan-1' }), update: async () => plan({ price_monthly: 1 }) },
    };
    await entitlements.resolve(TENANT_A);
    await new PlatformService(prisma, entitlements, {} as any).updatePlan('plan-1', { price_monthly: 99 });
    await entitlements.resolve(TENANT_A);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('EntitlementGuard', () => {
  const reflector = new Reflector();
  const guard = new EntitlementGuard(reflector);

  function run(handlerClass: any, method: string, http: string, mode: string, features: string[] = []) {
    const request: any = {
      method: http,
      tenantContext: contextFor(TENANT_A),
      entitlement: { mode, features: new Set(features), planCode: 'pro' },
    };
    const context = {
      getHandler: () => handlerClass.prototype[method],
      getClass: () => handlerClass,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return () => guard.canActivate(context);
  }

  // A normal tenant route with no special metadata.
  class Plain { list() {} create() {} }

  it('full and grace allow every method', () => {
    for (const mode of ['full', 'grace']) {
      expect(run(Plain, 'create', 'POST', mode)()).toBe(true);
      expect(run(Plain, 'list', 'GET', mode)()).toBe(true);
    }
  });

  it('read_only blocks writes and allows GET/HEAD', () => {
    expect(() => run(Plain, 'create', 'POST', 'read_only')()).toThrow(expect.objectContaining({ code: 'TENANT_READ_ONLY' }));
    expect(() => run(Plain, 'create', 'DELETE', 'read_only')()).toThrow(AthrDomainError);
    expect(run(Plain, 'list', 'GET', 'read_only')()).toBe(true);
    expect(run(Plain, 'list', 'HEAD', 'read_only')()).toBe(true);
  });

  it('suspended blocks everything, including reads', () => {
    expect(() => run(Plain, 'list', 'GET', 'suspended')()).toThrow(expect.objectContaining({ code: 'TENANT_SUSPENDED' }));
    expect(() => run(Plain, 'create', 'POST', 'suspended')()).toThrow(expect.objectContaining({ code: 'TENANT_SUSPENDED' }));
  });

  it('the session, subscription status and POS heartbeat routes stay reachable in every mode', () => {
    for (const mode of ['read_only', 'suspended']) {
      expect(run(AuthController, 'me', 'GET', mode)()).toBe(true);
      expect(run(SubscriptionController, 'status', 'GET', mode)()).toBe(true);
      expect(run(TerminalsController, 'heartbeat', 'POST', mode)()).toBe(true);
    }
    // ...while an ordinary write on the same controller is still blocked.
    expect(() => run(TerminalsController, 'update', 'PATCH', 'read_only')()).toThrow(AthrDomainError);
  });

  it('routes without a tenant context (public, platform) are skipped', () => {
    const context = {
      getHandler: () => Plain.prototype.create,
      getClass: () => Plain,
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST' }) }),
    } as unknown as ExecutionContext;
    expect(guard.canActivate(context)).toBe(true);
  });

  describe('@RequireFeature', () => {
    it('rejects a plan without the feature and accepts one that has it', () => {
      expect(() => run(PromotionController, 'list', 'GET', 'full', ['uom'])()).toThrow(
        expect.objectContaining({ code: 'ENTITLEMENT_FEATURE_NOT_IN_PLAN' }),
      );
      expect(run(PromotionController, 'list', 'GET', 'full', ['promotions'])()).toBe(true);
    });

    it('is declared on the promotion, coupon and bundle controllers and the uom write routes', () => {
      for (const controller of [PromotionController, CouponController, BundleController]) {
        expect(Reflect.getMetadata(REQUIRED_FEATURE_KEY, controller)).toBe('promotions');
      }
      const uom = UomController.prototype;
      for (const write of ['create', 'update', 'createConversion', 'supersedeConversion'] as const) {
        expect(Reflect.getMetadata(REQUIRED_FEATURE_KEY, uom[write])).toBe('uom');
      }
      // Every plan can read units of measure: products reference them.
      expect(Reflect.getMetadata(REQUIRED_FEATURE_KEY, uom.list)).toBeUndefined();
    });

    it('is enforced even on routes that stay open in every access mode', () => {
      class Open { @Reflect.metadata(ANY_ACCESS_MODE_KEY, true) status() {} }
      Reflect.defineMetadata(REQUIRED_FEATURE_KEY, 'uom', Open.prototype.status);
      expect(() => run(Open, 'status', 'GET', 'read_only', [])()).toThrow(AthrDomainError);
    });
  });
});

describe('TenantContextGuard wiring', () => {
  const user = actorFor('tenant_owner', { sub: 'u1', tenantId: TENANT_A, tenantWide: true });

  function contextFor_(handlerClass: any, method: string, entitlements: any, request: any) {
    const guard = new TenantContextGuard(new Reflector(), entitlements);
    const context = {
      getHandler: () => handlerClass.prototype[method],
      getClass: () => handlerClass,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context);
  }

  it('puts the real access mode and snapshot version on the tenant context instead of a hardcoded value', async () => {
    const entitlements = { resolve: jest.fn(async () => ({ mode: 'grace', snapshotVersion: 1234, features: new Set() })) };
    const request: any = { user };
    await contextFor_(SubscriptionController, 'status', entitlements, request);
    expect(entitlements.resolve).toHaveBeenCalledWith(TENANT_A);
    expect(request.tenantContext).toMatchObject({ tenantAccessMode: 'grace', entitlementSnapshotVersion: 1234 });
    expect(request.entitlement.mode).toBe('grace');
  });

  it('skips platform routes: no tenant is resolved for them', async () => {
    const entitlements = { resolve: jest.fn() };
    const request: any = { user: { sub: 'platform-admin', is_platform_admin: true, tenant_id: null } };
    await expect(contextFor_(PlatformController, 'listTenants', entitlements, request)).resolves.toBe(true);
    expect(request.tenantContext).toBeUndefined();
    expect(entitlements.resolve).not.toHaveBeenCalled();
  });

  it('a platform admin has no tenant access from the flag alone (ADR-0006)', async () => {
    const entitlements = { resolve: jest.fn() };
    const request: any = { user: { sub: 'platform-admin', is_platform_admin: true, tenant_id: null } };
    await expect(contextFor_(SubscriptionController, 'status', entitlements, request)).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_UNRESOLVABLE',
    });
  });
});

describe('platform console access', () => {
  const guard = new PlatformAdminGuard();
  const http = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

  it('every platform route is behind the platform guard and outside tenant context', () => {
    expect(Reflect.getMetadata(PLATFORM_ROUTE_KEY, PlatformController)).toBe(true);
    expect(Reflect.getMetadata('__guards__', PlatformController)).toContain(PlatformAdminGuard);
  });

  it('rejects an ordinary tenant user, even an owner', () => {
    const owner = actorFor('tenant_owner', { tenantWide: true });
    expect(() => guard.canActivate(http(owner))).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    expect(() => guard.canActivate(http(undefined))).toThrow(AthrDomainError);
    expect(() => guard.canActivate(http({ ...owner, is_platform_admin: false }))).toThrow(AthrDomainError);
  });

  it('accepts a platform admin', () => {
    expect(guard.canActivate(http({ sub: 'admin', is_platform_admin: true }))).toBe(true);
  });
});

describe('GET /subscription/status', () => {
  function controller() {
    const rows: Record<string, any> = {
      [TENANT_A]: subscription({ tenant_id: TENANT_A }, { code: 'pro', features: ['promotions'] }),
      [TENANT_B]: subscription({ tenant_id: TENANT_B, status: 'suspended' }, { code: 'starter', features: [], limits: { branches: 1 } }),
    };
    const prisma: any = { subscription: { findUnique: async ({ where }: any) => rows[where.tenant_id] ?? null } };
    const entitlements = new EntitlementService(prisma);
    const usage = jest.fn(async (tenantId: string) => ({ branches: tenantId === TENANT_A ? 2 : 1, terminals: 0, users: 0, products: 0 }));
    return { usage, controller: new SubscriptionController(entitlements, { usage } as any) };
  }

  it('reports only the calling tenant: plan, mode, features, limits and usage', async () => {
    const { controller: status, usage } = controller();
    const a = await status.status(contextFor(TENANT_A));
    expect(a).toMatchObject({ mode: 'full', plan: { code: 'pro' }, features: ['promotions'], limits: { branches: 3 }, usage: { branches: 2 } });
    const b = await status.status(contextFor(TENANT_B));
    expect(b).toMatchObject({ mode: 'suspended', plan: { code: 'starter' }, features: [], limits: { branches: 1 } });
    expect(usage.mock.calls.map(([id]) => id)).toEqual([TENANT_A, TENANT_B]);
  });
});

describe('POS sale gating', () => {
  const suspendedAt = new Date('2026-09-20T00:00:00Z');

  function controller(sub: any) {
    const prisma: any = { subscription: { findUnique: async () => sub } };
    const sales = { createSale: jest.fn().mockResolvedValue({ id: 'invoice-1' }) } as any;
    const terminals = {
      authenticateDevice: jest.fn().mockResolvedValue({ id: 't1', branch_id: 'b1', tenant_id: TENANT_A }),
    } as any;
    const reads = { invalidateCounts: jest.fn() } as any;
    return {
      sales,
      controller: new SalesController(sales, reads, {} as any, terminals, new EntitlementService(prisma)),
    };
  }
  const sale = (occurred_at: string) => ({ branch_id: 'b1', occurred_at, items: [] }) as any;

  it('accepts an offline sale that happened before the suspension, and rejects a new one', async () => {
    const { controller: pos, sales } = controller(subscription({ status: 'suspended', status_changed_at: suspendedAt }));
    await expect(pos.sale(sale('2026-09-19T10:00:00Z'), 'device', 'token')).resolves.toEqual({ id: 'invoice-1' });
    expect(sales.createSale).toHaveBeenCalledTimes(1);

    await expect(pos.sale(sale(new Date().toISOString()), 'device', 'token')).rejects.toMatchObject({ code: 'TENANT_SUSPENDED' });
    expect(sales.createSale).toHaveBeenCalledTimes(1);
  });

  it('does the same when the subscription ended past its grace period (read_only)', async () => {
    const { controller: pos, sales } = controller(subscription({ current_period_end: new Date(Date.now() - 30 * DAY) }));
    await expect(pos.sale(sale(new Date(Date.now() - 25 * DAY).toISOString()), 'device', 'token')).resolves.toBeDefined();
    await expect(pos.sale(sale(new Date().toISOString()), 'device', 'token')).rejects.toMatchObject({ code: 'TENANT_READ_ONLY' });
    expect(sales.createSale).toHaveBeenCalledTimes(1);
  });

  it('a normal, in-period tenant sells freely', async () => {
    const { controller: pos } = controller(subscription());
    await expect(pos.sale(sale(new Date().toISOString()), 'device', 'token')).resolves.toBeDefined();
  });
});
