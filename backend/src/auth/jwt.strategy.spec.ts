import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy authorization recheck cache', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
  });

  function setup(user: { id: string; is_active: boolean } | null, membership: unknown = null) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      membership: { findFirst: jest.fn().mockResolvedValue(membership) },
    };
    const permissionPolicy = { getCurrentVersion: jest.fn().mockResolvedValue(1) };
    return { prisma, strategy: new JwtStrategy(prisma as any, permissionPolicy as any) };
  }

  it('coalesces concurrent database rechecks and briefly caches the result', async () => {
    const { prisma, strategy } = setup({ id: 'user-1', is_active: true }, {
      id: 'm-1',
      tenant_id: 'tenant-1',
      role: 'tenant_owner',
      granted_permissions: [],
      revoked_permissions: [],
      access_scope_assignments: [
        { scope_type: 'tenant_wide', scope_ref_id: null, effective_from: new Date('2020-01-01'), effective_to: null },
      ],
    });
    const [first, second] = await Promise.all([
      strategy.validate({ sub: 'user-1', tenant_id: 'tenant-1' }),
      strategy.validate({ sub: 'user-1', tenant_id: 'tenant-1' }),
    ]);
    const third = await strategy.validate({ sub: 'user-1', tenant_id: 'tenant-1' });
    expect(first).toEqual(expect.objectContaining({
      sub: 'user-1',
      tenant_id: 'tenant-1',
      membership_id: 'm-1',
      membership_role: 'tenant_owner',
      scope_set: [{ scope_type: 'tenant_wide', scope_ref_id: null }],
    }));
    expect(first.permissions.has('users.manage' as never)).toBe(false);
    expect(first.permissions.has('membership.invite')).toBe(true);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects a disabled user', async () => {
    const { strategy } = setup({ id: 'user-1', is_active: false });
    await expect(strategy.validate({ sub: 'user-1' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('loads the membership of the tenant named in the token', async () => {
    const { prisma, strategy } = setup({ id: 'user-1', is_active: true }, null);
    await expect(strategy.validate({ sub: 'user-1', tenant_id: 'tenant-9' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { user_id: 'user-1', status: 'active', tenant_id: 'tenant-9' },
    }));
  });
});
