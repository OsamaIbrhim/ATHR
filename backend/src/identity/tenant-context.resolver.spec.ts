import { TenantContextResolver } from './tenant-context.resolver';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const IDENTITY_ID = '22222222-2222-2222-2222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-3333-3333-333333333333';

function fakePrisma(overrides: { tenant?: any; membership?: any } = {}) {
  return {
    tenant: {
      findUnique: jest.fn(async () =>
        overrides.tenant !== undefined
          ? overrides.tenant
          : { id: TENANT_ID, access_mode: 'active' },
      ),
    },
    membership: {
      findUnique: jest.fn(async () =>
        overrides.membership !== undefined
          ? overrides.membership
          : {
              id: MEMBERSHIP_ID,
              status: 'active',
              access_scope_assignments: [
                { scope_type: 'tenant_wide', scope_ref_id: null, effective_from: new Date('2020-01-01'), effective_to: null },
              ],
            },
      ),
    },
  } as any;
}

function fakePermissionPolicy(version = 1) {
  return { getCurrentVersion: jest.fn(async () => version) } as any;
}

describe('TenantContextResolver', () => {
  const baseInput = {
    authenticatedIdentityId: IDENTITY_ID,
    requestedTenantId: TENANT_ID,
    requestId: 'req-1',
    correlationId: 'corr-1',
  };

  it('resolves a full TenantContext for an active Membership', async () => {
    const resolver = new TenantContextResolver(fakePrisma(), fakePermissionPolicy(3));

    const result = await resolver.resolve(baseInput);

    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.value.tenantId).toBe(TENANT_ID);
    expect(result.value.membershipId).toBe(MEMBERSHIP_ID);
    expect(result.value.authenticatedIdentityId).toBe(IDENTITY_ID);
    expect(result.value.tenantAccessMode).toBe('active');
    expect(result.value.permissionPolicyVersion).toBe(3);
    expect(result.value.scopeSet).toEqual([{ scopeType: 'tenant_wide', scopeRefId: null }]);
    expect(result.value.actorType).toBe('human');
    expect(result.value.requestId).toBe('req-1');
    expect(result.value.correlationId).toBe('corr-1');
  });

  it('fails closed when the Tenant does not exist', async () => {
    const resolver = new TenantContextResolver(fakePrisma({ tenant: null }), fakePermissionPolicy());
    const result = await resolver.resolve(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('TENANT_CONTEXT_UNRESOLVABLE');
  });

  it('fails closed when there is no Membership for this Identity/Tenant pair', async () => {
    const resolver = new TenantContextResolver(fakePrisma({ membership: null }), fakePermissionPolicy());
    const result = await resolver.resolve(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('TENANT_CONTEXT_UNRESOLVABLE');
  });

  it('fails closed when the Membership exists but is not active (e.g. suspended)', async () => {
    const resolver = new TenantContextResolver(
      fakePrisma({ membership: { id: MEMBERSHIP_ID, status: 'suspended', access_scope_assignments: [] } }),
      fakePermissionPolicy(),
    );
    const result = await resolver.resolve(baseInput);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('TENANT_CONTEXT_UNRESOLVABLE');
  });

  it('excludes an expired (effective_to in the past) scope assignment from scope_set', async () => {
    const resolver = new TenantContextResolver(
      fakePrisma({
        membership: {
          id: MEMBERSHIP_ID,
          status: 'active',
          access_scope_assignments: [
            {
              scope_type: 'location',
              scope_ref_id: 'loc-1',
              effective_from: new Date('2020-01-01'),
              effective_to: new Date('2020-06-01'),
            },
          ],
        },
      }),
      fakePermissionPolicy(),
    );
    const result = await resolver.resolve(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.scopeSet).toEqual([]);
  });
});
