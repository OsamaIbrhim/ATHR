import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService refresh rotation', () => {
  const user = {
    id: 'user-1',
    branch_id: 'branch-1',
    name: 'Cashier',
    phone: '+201000000000',
    email: null,
    password_hash: 'hash',
    role: 'cashier' as const,
    is_active: true,
    created_at: new Date(),
  };

  function setup(revokedCount = 1) {
    const tx = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'old-token', user, revoked_at: null, expires_at: new Date(Date.now() + 60000),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: revokedCount }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      refreshToken: { create: jest.fn(), updateMany: jest.fn() },
      membership: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
    const permissionPolicy = { getCurrentVersion: jest.fn().mockResolvedValue(1) };
    return { service: new AuthService(prisma as any, jwt as any, permissionPolicy as any), tx, jwt, prisma };
  }

  it('revokes the presented token and returns a newly stored opaque token', async () => {
    const { service, tx, jwt } = setup();
    const result = await service.refresh('old-refresh-token');
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'old-token', revoked_at: null },
    }));
    expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(result.refresh_token).not.toBe('old-refresh-token');
    expect(result.access_token).toBe('access-token');
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sub: user.id, branch_id: user.branch_id }));
  });

  it('passes the requested tenant through to claim resolution on refresh', async () => {
    const { service, prisma } = setup();
    // mocked identity has no membership, so an explicit tenant is rejected
    await expect(service.refresh('old-refresh-token', 'tenant-2')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-2' }),
    }));
  });

  it('me() lists the active tenants (id + name)', async () => {
    const { service, prisma } = setup();
    Object.assign(prisma, { user: { findUnique: jest.fn().mockResolvedValue({ ...user, granted_capabilities: [], revoked_capabilities: [] }) } });
    Object.assign(prisma.membership, { findMany: jest.fn().mockResolvedValue([{ tenant: { id: 't1', name: 'Shop' } }]) });
    const me = await service.me(user.id);
    expect(me.tenants).toEqual([{ id: 't1', name: 'Shop' }]);
  });

  it('rejects concurrent reuse after another request has claimed the token', async () => {
    const { service } = setup(0);
    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
