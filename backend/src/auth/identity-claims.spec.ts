import { UnauthorizedException } from '@nestjs/common';
import { resolveIdentityClaims } from './identity-claims';

const membership = {
  id: 'm-1',
  tenant_id: 'tenant-1',
  role: 'cashier',
  granted_permissions: [] as string[],
  revoked_permissions: [] as string[],
  access_scope_assignments: [],
};

function setup(found: unknown) {
  const prisma = { membership: { findFirst: jest.fn().mockResolvedValue(found) } };
  const policy = { getCurrentVersion: jest.fn().mockResolvedValue(3) };
  return { prisma, run: (tenantId?: string) => resolveIdentityClaims(prisma as any, policy as any, 'user-1', tenantId) };
}

describe('resolveIdentityClaims tenant selection', () => {
  it('without a requested tenant picks the oldest active membership deterministically', async () => {
    const { prisma, run } = setup(membership);
    const claims = await run();
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { user_id: 'user-1', status: 'active' },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }));
    expect(claims.tenant_id).toBe('tenant-1');
  });

  it('checks a requested tenant against the user\'s active memberships', async () => {
    const { prisma, run } = setup(membership);
    await run('tenant-1');
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { user_id: 'user-1', status: 'active', tenant_id: 'tenant-1' },
    }));
  });

  it('rejects a requested tenant the user has no active membership in', async () => {
    const { run } = setup(null);
    await expect(run('tenant-x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns empty claims when there is no membership and no tenant was requested', async () => {
    const { run } = setup(null);
    const claims = await run();
    expect(claims.tenant_id).toBeNull();
    expect(claims.membership_role).toBeNull();
    expect(claims.permissions.size).toBe(0);
  });
});

describe('resolveIdentityClaims effective permissions and scope', () => {
  it('applies role defaults + granted - revoked from the membership', async () => {
    const { run } = setup({
      ...membership,
      granted_permissions: ['pricing.cost.view'],
      revoked_permissions: ['sales.sale.create'],
    });
    const { permissions } = await run();
    expect(permissions.has('sales.sale.view')).toBe(true);
    expect(permissions.has('pricing.cost.view')).toBe(true);
    expect(permissions.has('sales.sale.create')).toBe(false);
  });

  it('only includes access scopes that are in effect', async () => {
    const { run } = setup({
      ...membership,
      access_scope_assignments: [
        { scope_type: 'location', scope_ref_id: 'b-now', effective_from: new Date('2020-01-01'), effective_to: null },
        { scope_type: 'location', scope_ref_id: 'b-expired', effective_from: new Date('2020-01-01'), effective_to: new Date('2021-01-01') },
        { scope_type: 'location', scope_ref_id: 'b-future', effective_from: new Date('2999-01-01'), effective_to: null },
      ],
    });
    expect((await run()).scope_set).toEqual([{ scope_type: 'location', scope_ref_id: 'b-now' }]);
  });
});
