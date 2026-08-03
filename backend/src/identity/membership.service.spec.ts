import { MembershipService } from './membership.service';
import { TenantContext } from './tenant-context.type';

const context = { tenantId: 'tenant-1' } as unknown as TenantContext;

function fakeRepository(memberships: Record<string, any>, activeOwnerCount = 1) {
  return {
    findById: jest.fn(async (_ctx: any, id: string) => memberships[id] ?? null),
    countActiveByRole: jest.fn(async () => activeOwnerCount),
    updateStatus: jest.fn(async (_ctx: any, id: string, status: string) => {
      memberships[id] = { ...memberships[id], status };
      return memberships[id];
    }),
    updateRole: jest.fn(async (_ctx: any, id: string, role: string) => {
      memberships[id] = { ...memberships[id], role };
      return memberships[id];
    }),
    list: jest.fn(),
  } as any;
}

describe('MembershipService — state machine (BR-MEM-101)', () => {
  const validTransitions: Array<[string, string]> = [
    ['invited', 'pending_verification'],
    ['invited', 'active'],
    ['invited', 'deactivated'],
    ['pending_verification', 'active'],
    ['pending_verification', 'deactivated'],
    ['active', 'suspended'],
    ['active', 'deactivated'],
    ['active', 'expired'],
    ['suspended', 'active'],
    ['suspended', 'deactivated'],
    ['expired', 'active'],
  ];

  it.each(validTransitions)('allows %s -> %s', async (from, to) => {
    const memberships = { m1: { id: 'm1', role: 'seller', status: from } };
    const service = new MembershipService(fakeRepository(memberships, 5));
    const result = await service.transition(context, 'm1', to as any);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe(to);
  });

  const invalidTransitions: Array<[string, string]> = [
    ['deactivated', 'active'],
    ['deactivated', 'suspended'],
    ['invited', 'suspended'],
    ['active', 'invited'],
    ['expired', 'suspended'],
    ['suspended', 'pending_verification'],
  ];

  it.each(invalidTransitions)('rejects %s -> %s', async (from, to) => {
    const memberships = { m1: { id: 'm1', role: 'seller', status: from } };
    const service = new MembershipService(fakeRepository(memberships, 5));
    const result = await service.transition(context, 'm1', to as any);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('MEMBERSHIP_INVALID_STATE_TRANSITION');
  });

  it('returns MEMBERSHIP_NOT_FOUND for an unknown membership id', async () => {
    const service = new MembershipService(fakeRepository({}));
    const result = await service.transition(context, 'missing', 'suspended' as any);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('MEMBERSHIP_NOT_FOUND');
  });
});

describe('MembershipService — last-owner safeguard (BR-OWN-100)', () => {
  it('blocks suspending the sole active Tenant Owner', async () => {
    const memberships = { m1: { id: 'm1', role: 'tenant_owner', status: 'active' } };
    const repository = fakeRepository(memberships, 1);
    const service = new MembershipService(repository);

    const result = await service.suspend(context, 'm1');

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('LAST_OWNER_SAFEGUARD_VIOLATION');
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it('blocks deactivating the sole active Tenant Owner', async () => {
    const memberships = { m1: { id: 'm1', role: 'tenant_owner', status: 'active' } };
    const service = new MembershipService(fakeRepository(memberships, 1));
    const result = await service.deactivate(context, 'm1');
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('LAST_OWNER_SAFEGUARD_VIOLATION');
  });

  it('blocks reassigning the sole active Tenant Owner to a non-owner role', async () => {
    const memberships = { m1: { id: 'm1', role: 'tenant_owner', status: 'active' } };
    const service = new MembershipService(fakeRepository(memberships, 1));
    const result = await service.changeRole(context, 'm1', 'location_manager' as any);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('LAST_OWNER_SAFEGUARD_VIOLATION');
  });

  it('allows suspending an Owner when a second active Owner exists', async () => {
    const memberships = { m1: { id: 'm1', role: 'tenant_owner', status: 'active' } };
    const repository = fakeRepository(memberships, 2);
    const service = new MembershipService(repository);

    const result = await service.suspend(context, 'm1');

    expect(result.ok).toBe(true);
    expect(repository.updateStatus).toHaveBeenCalledWith(context, 'm1', 'suspended');
  });

  it('allows reassigning an Owner to a non-owner role when a second active Owner exists', async () => {
    const memberships = { m1: { id: 'm1', role: 'tenant_owner', status: 'active' } };
    const service = new MembershipService(fakeRepository(memberships, 2));
    const result = await service.changeRole(context, 'm1', 'cashier' as any);
    expect(result.ok).toBe(true);
  });

  it('does not apply the safeguard to a non-owner role', async () => {
    const memberships = { m1: { id: 'm1', role: 'cashier', status: 'active' } };
    const repository = fakeRepository(memberships, 1);
    const service = new MembershipService(repository);

    const result = await service.suspend(context, 'm1');

    expect(result.ok).toBe(true);
    expect(repository.countActiveByRole).not.toHaveBeenCalled();
  });

  it('does not apply the safeguard to an Owner that is already inactive', async () => {
    const memberships = { m1: { id: 'm1', role: 'tenant_owner', status: 'suspended' } };
    const repository = fakeRepository(memberships, 0);
    const service = new MembershipService(repository);

    const result = await service.deactivate(context, 'm1');

    expect(result.ok).toBe(true);
  });
});
