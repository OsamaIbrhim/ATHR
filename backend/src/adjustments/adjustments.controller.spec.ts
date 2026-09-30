import 'reflect-metadata';
import { AdjustmentsController } from './adjustments.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../identity/permission.guard';
import { actorFor } from '../auth/testing/actors';
import { AdjustmentsService } from './adjustments.service';

/** Each step of the document is gated by its own existing permission key. */

const required = (method: keyof AdjustmentsController) =>
  Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, AdjustmentsController.prototype[method]) as string[] | undefined;

describe('adjustments controller permissions', () => {
  it('gates request, approve and post with the three existing inventory.adjustment keys', () => {
    expect(required('create')).toEqual(['inventory.adjustment.request']);
    expect(required('update')).toEqual(['inventory.adjustment.request']);
    expect(required('approve')).toEqual(['inventory.adjustment.approve']);
    expect(required('post')).toEqual(['inventory.adjustment.post']);
  });

  it('lets only ledger readers see documents, and leaves cancel to the service (request or approve)', () => {
    expect(required('list')).toEqual(['inventory.movement.view']);
    expect(required('get')).toEqual(['inventory.movement.view']);
    expect(required('cancel')).toBeUndefined();
  });

  it('holds: a cashier has none of the steps, the warehouse manager and owner have all of them', () => {
    const steps = ['inventory.adjustment.request', 'inventory.adjustment.approve', 'inventory.adjustment.post'];
    const cashier = actorFor('cashier');
    expect(steps.some((key) => cashier.permissions.has(key as any))).toBe(false);
    for (const role of ['warehouse_manager', 'tenant_owner'] as const) {
      const actor = actorFor(role);
      expect(steps.every((key) => actor.permissions.has(key as any))).toBe(true);
    }
  });

  it('refuses to cancel for someone who may neither request nor approve', async () => {
    const service = new AdjustmentsService({} as any, {} as any, {} as any);
    await expect(service.cancel({ tenantId: 't' } as any, 'id', {}, actorFor('cashier'))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
