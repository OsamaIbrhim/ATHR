import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { actorFor } from './testing/actors';

const user = {
  id: 'user-1',
  name: 'Cashier',
  phone: '+201000000000',
  email: null,
  password_hash: 'hash',
  is_active: true,
  created_at: new Date(),
};

function membershipIn(tenantId: string, extra: Record<string, unknown> = {}) {
  return {
    id: `membership-${tenantId}`,
    tenant_id: tenantId,
    role: 'cashier',
    granted_permissions: [],
    revoked_permissions: [],
    access_scope_assignments: [
      { scope_type: 'location', scope_ref_id: 'branch-1', effective_from: new Date('2020-01-01'), effective_to: null },
    ],
    ...extra,
  };
}

describe('AuthService', () => {
  function setup(options: { revokedCount?: number; storedTenantId?: string | null; membership?: unknown } = {}) {
    const tx = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'old-token',
          user,
          tenant_id: options.storedTenantId ?? null,
          revoked_at: null,
          expires_at: new Date(Date.now() + 60000),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: options.revokedCount ?? 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
      refreshToken: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn() },
      membership: {
        findFirst: jest.fn().mockResolvedValue(options.membership === undefined ? null : options.membership),
        findMany: jest.fn().mockResolvedValue([{ tenant: { id: 't1', name: 'Shop' } }]),
      },
      user: { findUnique: jest.fn().mockResolvedValue(user) },
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
    const permissionPolicy = { getCurrentVersion: jest.fn().mockResolvedValue(8) };
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
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sub: user.id }));
  });

  it('refresh keeps the tenant the session was issued for', async () => {
    const { service, tx, prisma, jwt } = setup({
      storedTenantId: 'tenant-2',
      membership: membershipIn('tenant-2'),
    });
    const result = await service.refresh('old-refresh-token');
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenant_id: 'tenant-2' }),
    }));
    expect(tx.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: user.id, tenant_id: 'tenant-2' }),
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'tenant-2' }));
    expect(result.user.tenant_id).toBe('tenant-2');
  });

  it('refresh fails when the membership of the original tenant is no longer active', async () => {
    const { service } = setup({ storedTenantId: 'tenant-2', membership: null });
    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('an explicit tenant on refresh overrides the stored one (and must be an active membership)', async () => {
    const { service, prisma } = setup({ storedTenantId: 'tenant-2', membership: null });
    await expect(service.refresh('old-refresh-token', 'tenant-3')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenant_id: 'tenant-3' }),
    }));
  });

  it('a session for a membership returns the membership role, scope and effective permissions', async () => {
    const { service } = setup({
      membership: membershipIn('tenant-1', { granted_permissions: ['pricing.cost.view'], revoked_permissions: ['sales.sale.create'] }),
    });
    const session = await (service as any).createSession(user);
    expect(session.user).toMatchObject({
      id: 'user-1',
      // Client-compatible role name, so POS/admin keep working unchanged.
      role: 'cashier',
      membership_role: 'cashier',
      branch_id: 'branch-1',
      tenant_id: 'tenant-1',
      membership_id: 'membership-tenant-1',
      scope_set: [{ scope_type: 'location', scope_ref_id: 'branch-1' }],
    });
    expect(session.user.permissions).toContain('pricing.cost.view');
    expect(session.user.permissions).toContain('sales.sale.view');
    expect(session.user.permissions).not.toContain('sales.sale.create');
  });

  it('a branch manager is still reported to clients as "branch_manager"', async () => {
    const { service } = setup({ membership: membershipIn('tenant-1', { role: 'location_manager' }) });
    const session = await (service as any).createSession(user);
    expect(session.user).toMatchObject({ role: 'branch_manager', membership_role: 'location_manager' });
  });

  it('a user without any membership gets a session with no tenant, role or permissions', async () => {
    const { service } = setup({ membership: null });
    const session = await (service as any).createSession(user);
    expect(session.user).toMatchObject({ role: null, tenant_id: null, branch_id: null, permissions: [] });
  });

  it('me() lists the active tenants (id + name) next to the current membership', async () => {
    const { service } = setup();
    const me = await service.me(actorFor('cashier', { branchId: 'branch-1' }));
    expect(me.tenants).toEqual([{ id: 't1', name: 'Shop' }]);
    expect(me.membership_role).toBe('cashier');
  });

  it('rejects concurrent reuse after another request has claimed the token', async () => {
    const { service } = setup({ revokedCount: 0 });
    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
