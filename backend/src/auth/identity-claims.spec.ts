import { UnauthorizedException } from '@nestjs/common';
import { resolveIdentityClaims } from './identity-claims';

const membership = {
  id: 'm-1', tenantId: 'tenant-1', role: 'owner', access_scope_assignments: [],
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
      where: { identityId: 'user-1', status: 'active' },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }));
    expect(claims.tenant_id).toBe('tenant-1');
  });

  it('checks a requested tenant against the identity\'s active memberships', async () => {
    const { prisma, run } = setup(membership);
    await run('tenant-1');
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { identityId: 'user-1', status: 'active', tenantId: 'tenant-1' },
    }));
  });

  it('rejects a requested tenant the identity has no active membership in', async () => {
    const { run } = setup(null);
    await expect(run('tenant-x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns empty claims when there is no membership and no tenant was requested', async () => {
    const { run } = setup(null);
    expect((await run()).tenant_id).toBeNull();
  });
});
