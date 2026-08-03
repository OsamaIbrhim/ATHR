import { AccessScopeService } from './access-scope.service';
import { TenantContext } from './tenant-context.type';

const context = { tenantId: 'tenant-1' } as unknown as TenantContext;

function fakeRepository() {
  return {
    save: jest.fn(async (_ctx: any, input: any) => ({ id: 'scope-1', ...input })),
    list: jest.fn(async () => []),
    revoke: jest.fn(async () => ({ id: 'scope-1', effective_to: new Date() })),
    findById: jest.fn(),
  } as any;
}

describe('AccessScopeService — BR-SCP-101 (empty scope is never implicitly tenant-wide)', () => {
  it('rejects a missing scope_type', async () => {
    const repository = fakeRepository();
    const service = new AccessScopeService(repository);

    const result = await service.assign(context, {
      membershipId: 'm-1',
      scopeType: null,
      scopeRefId: null,
      grantSource: 'manual',
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('ACCESS_SCOPE_REQUIRED');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects a non-tenant-wide scope without a scope_ref_id', async () => {
    const repository = fakeRepository();
    const service = new AccessScopeService(repository);

    const result = await service.assign(context, {
      membershipId: 'm-1',
      scopeType: 'location',
      scopeRefId: null,
      grantSource: 'manual',
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('ACCESS_SCOPE_REFERENCE_REQUIRED');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('accepts an explicit tenant_wide scope with no ref id', async () => {
    const repository = fakeRepository();
    const service = new AccessScopeService(repository);

    const result = await service.assign(context, {
      membershipId: 'm-1',
      scopeType: 'tenant_wide',
      scopeRefId: null,
      grantSource: 'manual',
    });

    expect(result.ok).toBe(true);
    expect(repository.save).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ scopeType: 'tenant_wide', scopeRefId: null }),
    );
  });

  it('accepts a location scope with an explicit scope_ref_id', async () => {
    const repository = fakeRepository();
    const service = new AccessScopeService(repository);

    const result = await service.assign(context, {
      membershipId: 'm-1',
      scopeType: 'location',
      scopeRefId: 'location-1',
      grantSource: 'manual',
    });

    expect(result.ok).toBe(true);
    expect(repository.save).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ scopeType: 'location', scopeRefId: 'location-1' }),
    );
  });
});
