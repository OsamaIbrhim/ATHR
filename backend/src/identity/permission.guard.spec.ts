import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../auth/public.decorator';
import { actorFor } from '../auth/testing/actors';
import { PermissionGuard, RequirePermission } from './permission.guard';

class Sample {
  @RequirePermission('sales.sale.create')
  sell() {}

  @RequirePermission('sales.sale.create', 'pricing.cost.view')
  sellWithCost() {}

  open() {}

  @Public()
  @RequirePermission('sales.sale.create')
  publicSell() {}
}

@RequirePermission('inventory.position.view')
class ClassGuarded {
  view() {}

  @RequirePermission('inventory.adjustment.post')
  adjust() {}
}

function run(type: new () => object, handler: string, user: unknown) {
  const context = {
    getHandler: () => (type.prototype as any)[handler],
    getClass: () => type,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return new PermissionGuard(new Reflector()).canActivate(context);
}

describe('PermissionGuard (the one authorization guard)', () => {
  it('allows a membership whose effective permissions contain the key', () => {
    expect(run(Sample, 'sell', actorFor('cashier'))).toBe(true);
  });

  it('rejects a membership role that does not grant the key', () => {
    expect(() => run(Sample, 'sell', actorFor('seller'))).toThrow(/does not grant "sales.sale.create"/);
  });

  it('honours a per-user grant on top of the role defaults', () => {
    expect(() => run(Sample, 'sellWithCost', actorFor('cashier'))).toThrow(/pricing.cost.view/);
    expect(run(Sample, 'sellWithCost', actorFor('cashier', { granted: ['pricing.cost.view'] }))).toBe(true);
  });

  it('honours a per-user revoke of a role default', () => {
    expect(() => run(Sample, 'sell', actorFor('cashier', { revoked: ['sales.sale.create'] })))
      .toThrow(/does not grant "sales.sale.create"/);
  });

  it('requires every listed key (AND)', () => {
    const partial = actorFor('cashier', { granted: ['pricing.cost.view'], revoked: ['sales.sale.create'] });
    expect(() => run(Sample, 'sellWithCost', partial)).toThrow(/sales.sale.create/);
  });

  it('denies a user with no membership in the tenant', () => {
    const noMembership = { ...actorFor('cashier'), membership_role: null, permissions: new Set() };
    expect(() => run(Sample, 'sell', noMembership)).toThrow(/No active Membership/);
    expect(() => run(Sample, 'sell', undefined)).toThrow(/No active Membership/);
  });

  it('does not guard routes without a permission, or public routes', () => {
    expect(run(Sample, 'open', undefined)).toBe(true);
    expect(run(Sample, 'publicSell', undefined)).toBe(true);
  });

  it('lets a handler-level key override the class-level one', () => {
    const cashier = actorFor('cashier');
    expect(run(ClassGuarded, 'view', cashier)).toBe(true);
    expect(() => run(ClassGuarded, 'adjust', cashier)).toThrow(/inventory.adjustment.post/);
    expect(run(ClassGuarded, 'adjust', actorFor('warehouse_manager'))).toBe(true);
  });
});
