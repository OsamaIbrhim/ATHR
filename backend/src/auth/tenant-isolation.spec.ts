import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { TENANT_A, TENANT_B, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * A membership in tenant A never grants anything in tenant B: the request user
 * is built from the Membership of the tenant named by the session, and a tenant
 * the user has no active membership in is rejected.
 */

const USER = 'user-1';
const TENANT_C = 'tenant-c';

const membership = (tenantId: string, role: string, status = 'active', scopeType = 'tenant_wide') => ({
  id: `m-${tenantId}`,
  tenant_id: tenantId,
  user_id: USER,
  role,
  status,
  granted_permissions: [] as string[],
  revoked_permissions: [] as string[],
  created_at: new Date('2026-01-01'),
  access_scope_assignments: [
    { scope_type: scopeType, scope_ref_id: scopeType === 'tenant_wide' ? null : 'branch-b', effective_from: new Date('2020-01-01'), effective_to: null },
  ],
});

function strategy(memberships: ReturnType<typeof membership>[]) {
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
  const prisma = fakePrisma({ user: [{ id: USER, is_active: true }], membership: memberships });
  const policy = { getCurrentVersion: async () => 8 };
  return new JwtStrategy(prisma, policy as any);
}

describe('tenant isolation of the request user', () => {
  it('owner in tenant A and cashier in tenant B: each session gets only its own tenant\'s role, permissions and scope', async () => {
    const jwt = strategy([
      membership(TENANT_A, 'tenant_owner'),
      membership(TENANT_B, 'cashier', 'active', 'location'),
    ]);

    const inA = await jwt.validate({ sub: USER, tenant_id: TENANT_A });
    expect(inA.tenant_id).toBe(TENANT_A);
    expect(inA.membership_role).toBe('tenant_owner');
    expect(inA.permissions.has('membership.invite')).toBe(true);

    const inB = await jwt.validate({ sub: USER, tenant_id: TENANT_B });
    expect(inB.tenant_id).toBe(TENANT_B);
    expect(inB.membership_role).toBe('cashier');
    // Nothing the owner holds in A leaks into B.
    expect(inB.permissions.has('membership.invite')).toBe(false);
    expect(inB.permissions.has('pricing.cost.view')).toBe(false);
    expect(inB.scope_set).toEqual([{ scope_type: 'location', scope_ref_id: 'branch-b' }]);
  });

  it('a session naming a tenant without an active membership is rejected, never falling back to another tenant', async () => {
    const jwt = strategy([membership(TENANT_A, 'tenant_owner')]);
    await expect(jwt.validate({ sub: USER, tenant_id: TENANT_C })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a suspended membership grants nothing in that tenant', async () => {
    const jwt = strategy([membership(TENANT_A, 'tenant_owner'), membership(TENANT_B, 'cashier', 'suspended')]);
    await expect(jwt.validate({ sub: USER, tenant_id: TENANT_B })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('per-user grants and revokes are stored on, and apply only to, the membership they belong to', async () => {
    const granted = { ...membership(TENANT_A, 'cashier'), granted_permissions: ['pricing.cost.view'] };
    const jwt = strategy([granted, membership(TENANT_B, 'cashier')]);
    expect((await jwt.validate({ sub: USER, tenant_id: TENANT_A })).permissions.has('pricing.cost.view')).toBe(true);
    expect((await jwt.validate({ sub: USER, tenant_id: TENANT_B })).permissions.has('pricing.cost.view')).toBe(false);
  });
});
