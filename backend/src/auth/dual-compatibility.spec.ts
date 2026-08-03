import { AuthService } from './auth.service';

/**
 * WP-006 §7 — "the single most important test in this WP given the
 * MT-MIG-005 requirement". Proves that a session/token issued *after*
 * this WP's additive claims land still lets an "old-shape" consumer — one
 * written against the pre-WP-006 shape, that only ever reads
 * `sub`/`role`/`branch_id` from the token payload and
 * `id`/`name`/`role`/`branch_id`/`capabilities` from `user` — keep working
 * identically. It must not need to know the new fields exist.
 */

const user = {
  id: 'user-1',
  branch_id: 'branch-1',
  name: 'Cashier One',
  phone: '+201000000000',
  email: null,
  password_hash: 'hash',
  role: 'cashier' as const,
  is_active: true,
  created_at: new Date(),
};

function setup(membership: any = null) {
  const capturedPayloads: any[] = [];
  const prisma = {
    refreshToken: { create: jest.fn().mockResolvedValue({}) },
    membership: { findFirst: jest.fn().mockResolvedValue(membership) },
  };
  const jwt = {
    signAsync: jest.fn((payload: any) => {
      capturedPayloads.push(payload);
      return Promise.resolve('signed-access-token');
    }),
  };
  const permissionPolicy = { getCurrentVersion: jest.fn().mockResolvedValue(7) };
  const service = new AuthService(prisma as any, jwt as any, permissionPolicy as any);
  return { service, capturedPayloads };
}

/** Simulates a pre-WP-006 client: reads only the fields that existed before this WP. */
function readAsOldShapeConsumer(payload: any, sessionUser: any) {
  return {
    tokenClaims: { sub: payload.sub, role: payload.role, branch_id: payload.branch_id },
    profile: {
      id: sessionUser.id,
      name: sessionUser.name,
      role: sessionUser.role,
      branch_id: sessionUser.branch_id,
      capabilities: sessionUser.capabilities,
    },
  };
}

describe('Dual-compatibility: additive session/token claims never break an old-shape consumer', () => {
  it('an old-shape consumer reading a user with no active Membership sees the exact pre-WP-006 shape/values', async () => {
    const { service, capturedPayloads } = setup(null);
    const session = await (service as any).createSession(user);

    const old = readAsOldShapeConsumer(capturedPayloads[0], session.user);

    expect(old.tokenClaims).toEqual({ sub: 'user-1', role: 'cashier', branch_id: 'branch-1' });
    expect(old.profile).toEqual({
      id: 'user-1',
      name: 'Cashier One',
      role: 'cashier',
      branch_id: 'branch-1',
      capabilities: expect.any(Array),
    });
  });

  it('an old-shape consumer reading a user WITH an active Membership still sees the exact pre-WP-006 shape/values', async () => {
    const membership = {
      id: 'membership-1',
      tenantId: 'tenant-1',
      access_scope_assignments: [
        { scope_type: 'tenant_wide', scope_ref_id: null, effective_from: new Date('2020-01-01'), effective_to: null },
      ],
    };
    const { service, capturedPayloads } = setup(membership);
    const session = await (service as any).createSession(user);

    const old = readAsOldShapeConsumer(capturedPayloads[0], session.user);

    expect(old.tokenClaims).toEqual({ sub: 'user-1', role: 'cashier', branch_id: 'branch-1' });
    expect(old.profile).toEqual({
      id: 'user-1',
      name: 'Cashier One',
      role: 'cashier',
      branch_id: 'branch-1',
      capabilities: expect.any(Array),
    });
  });

  it('the new claims are present additively, alongside the unchanged old ones, when a Membership exists', async () => {
    const membership = {
      id: 'membership-1',
      tenantId: 'tenant-1',
      access_scope_assignments: [
        { scope_type: 'location', scope_ref_id: 'loc-1', effective_from: new Date('2020-01-01'), effective_to: null },
      ],
    };
    const { service, capturedPayloads } = setup(membership);
    const session = await (service as any).createSession(user);
    const payload = capturedPayloads[0];

    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('cashier');
    expect(payload.branch_id).toBe('branch-1');
    expect(payload.tenant_id).toBe('tenant-1');
    expect(payload.membership_id).toBe('membership-1');
    expect(payload.scope_set).toEqual([{ scope_type: 'location', scope_ref_id: 'loc-1' }]);
    expect(payload.permission_policy_version).toBe(7);

    expect(session.user.tenant_id).toBe('tenant-1');
    expect(session.user.membership_id).toBe('membership-1');
    expect(session.user.permission_policy_version).toBe(7);
  });

  it('the new claims are null/empty (never omitted, never throwing) when there is no active Membership', async () => {
    const { service, capturedPayloads } = setup(null);
    const session = await (service as any).createSession(user);
    const payload = capturedPayloads[0];

    expect(payload.tenant_id).toBeNull();
    expect(payload.membership_id).toBeNull();
    expect(payload.scope_set).toEqual([]);
    expect(payload.permission_policy_version).toBeNull();
    expect(session.user.tenant_id).toBeNull();
  });
});
