import { InvitationService } from './invitation.service';
import { TenantContext } from './tenant-context.type';

const context = { tenantId: 'tenant-1' } as unknown as TenantContext;

function fakeInvitationRepository(rows: Record<string, any> = {}) {
  return {
    findById: jest.fn(async (_ctx: any, id: string) => rows[id] ?? null),
    list: jest.fn(async () => Object.values(rows)),
    findByTokenHash: jest.fn(async (tokenHash: string) => Object.values(rows).find((r: any) => r.token_hash === tokenHash) ?? null),
    findPendingByEmail: jest.fn(async (_ctx: any, email: string) =>
      Object.values(rows).find((r: any) => r.email === email && r.status === 'pending') ?? null,
    ),
    save: jest.fn(async (_ctx: any, input: any) => {
      const id = `inv-${Object.keys(rows).length + 1}`;
      const row = {
        id,
        tenant_id: 'tenant-1',
        status: 'pending',
        scope_type: input.scopeType,
        scope_ref_id: input.scopeRefId,
        role: input.role,
        email: input.email,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
      };
      rows[id] = row;
      return row;
    }),
    markAccepted: jest.fn(async (id: string, membershipId: string) => {
      rows[id] = { ...rows[id], status: 'accepted', accepted_membership_id: membershipId };
      return rows[id];
    }),
    markExpired: jest.fn(async (id: string) => {
      rows[id] = { ...rows[id], status: 'expired' };
      return rows[id];
    }),
    markRevoked: jest.fn(async (_ctx: any, id: string) => {
      rows[id] = { ...rows[id], status: 'revoked' };
      return rows[id];
    }),
  } as any;
}

function fakeMembershipRepository(existing: any = null) {
  return {
    findByIdentity: jest.fn(async () => existing),
    save: jest.fn(async (_ctx: any, input: any) => ({ id: 'membership-1', status: input.status, role: input.role })),
  } as any;
}

function fakeAccessScopeService() {
  return { assign: jest.fn(async () => ({ ok: true, value: {} })) } as any;
}

describe('InvitationService.create', () => {
  it('rejects an invitation with no scope_type', async () => {
    const service = new InvitationService(fakeInvitationRepository(), fakeMembershipRepository(), fakeAccessScopeService());
    const result = await service.create(context, {
      email: 'a@example.com',
      role: 'cashier',
      scopeType: null,
      scopeRefId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('ACCESS_SCOPE_REQUIRED');
  });

  it('rejects a non-tenant-wide invitation with no scope_ref_id', async () => {
    const service = new InvitationService(fakeInvitationRepository(), fakeMembershipRepository(), fakeAccessScopeService());
    const result = await service.create(context, {
      email: 'a@example.com',
      role: 'cashier',
      scopeType: 'location',
      scopeRefId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('ACCESS_SCOPE_REFERENCE_REQUIRED');
  });

  it('creates a pending invitation and returns a single-use raw token', async () => {
    const service = new InvitationService(fakeInvitationRepository(), fakeMembershipRepository(), fakeAccessScopeService());
    const result = await service.create(context, {
      email: 'a@example.com',
      role: 'cashier',
      scopeType: 'tenant_wide',
      scopeRefId: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.invitation.status).toBe('pending');
      expect(typeof result.value.token).toBe('string');
      expect(result.value.token.length).toBeGreaterThan(16);
    }
  });

  it('BR-INVIT-102: re-inviting the same pending email revokes the old row instead of duplicating it', async () => {
    const rows: Record<string, any> = {};
    const repository = fakeInvitationRepository(rows);
    const service = new InvitationService(repository, fakeMembershipRepository(), fakeAccessScopeService());

    await service.create(context, { email: 'a@example.com', role: 'cashier', scopeType: 'tenant_wide', scopeRefId: null });
    await service.create(context, { email: 'a@example.com', role: 'seller', scopeType: 'tenant_wide', scopeRefId: null });

    const statuses = Object.values(rows).map((r: any) => r.status);
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'revoked')).toHaveLength(1);
  });
});

describe('InvitationService.accept', () => {
  async function createPending(overrides: Partial<any> = {}) {
    const rows: Record<string, any> = {};
    const invitationRepository = fakeInvitationRepository(rows);
    const membershipRepository = fakeMembershipRepository();
    const accessScope = fakeAccessScopeService();
    const service = new InvitationService(invitationRepository, membershipRepository, accessScope);
    const created = await service.create(context, {
      email: 'a@example.com',
      role: 'cashier',
      scopeType: 'tenant_wide',
      scopeRefId: null,
    });
    if (created.ok === false) throw new Error('setup failed');
    Object.assign(rows[created.value.invitation.id], overrides);
    return { service, token: created.value.token, invitationId: created.value.invitation.id, membershipRepository, accessScope, rows };
  }

  it('accepts a valid, unexpired invitation and creates an active Membership', async () => {
    const { service, token, accessScope } = await createPending();
    const result = await service.accept({ token, acceptingIdentityId: 'identity-1' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('active');
    expect(accessScope.assign).toHaveBeenCalled();
  });

  it('rejects an unknown token', async () => {
    const { service } = await createPending();
    const result = await service.accept({ token: 'not-a-real-token', acceptingIdentityId: 'identity-1' });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('INVITATION_TOKEN_INVALID');
  });

  it('rejects acceptance of an expired invitation and marks it expired', async () => {
    const { service, token, rows, invitationId } = await createPending({ expires_at: new Date(Date.now() - 1000) });
    const result = await service.accept({ token, acceptingIdentityId: 'identity-1' });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('INVITATION_EXPIRED');
    expect(rows[invitationId].status).toBe('expired');
  });

  it('rejects acceptance of an already-accepted invitation', async () => {
    const { service, token } = await createPending();
    await service.accept({ token, acceptingIdentityId: 'identity-1' });
    const second = await service.accept({ token, acceptingIdentityId: 'identity-2' });
    expect(second.ok).toBe(false);
    if (second.ok === false) expect(second.failure.code).toBe('INVITATION_ALREADY_ACCEPTED');
  });

  it('rejects acceptance of a revoked invitation', async () => {
    const { service, token } = await createPending({ status: 'revoked' });
    const result = await service.accept({ token, acceptingIdentityId: 'identity-1' });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('INVITATION_TOKEN_INVALID');
  });

  it('BR-MEM-100: rejects acceptance when the identity already has an active Membership in this Tenant', async () => {
    const rows: Record<string, any> = {};
    const invitationRepository = fakeInvitationRepository(rows);
    const membershipRepository = fakeMembershipRepository({ id: 'existing', status: 'active' });
    const service = new InvitationService(invitationRepository, membershipRepository, fakeAccessScopeService());
    const created = await service.create(context, {
      email: 'a@example.com',
      role: 'cashier',
      scopeType: 'tenant_wide',
      scopeRefId: null,
    });
    if (created.ok === false) throw new Error('setup failed');

    const result = await service.accept({ token: created.value.token, acceptingIdentityId: 'identity-1' });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('MEMBERSHIP_ALREADY_EXISTS');
  });
});

describe('InvitationService.expire / revoke — idempotent (BR-TERR-101 style)', () => {
  it('expire is a no-op on an already-accepted invitation, not an error', async () => {
    const rows = { 'inv-1': { id: 'inv-1', status: 'accepted' } };
    const service = new InvitationService(fakeInvitationRepository(rows), fakeMembershipRepository(), fakeAccessScopeService());
    const result = await service.expire(context, 'inv-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('accepted');
  });

  it('revoke is a no-op on an already-revoked invitation, not an error', async () => {
    const rows = { 'inv-1': { id: 'inv-1', status: 'revoked' } };
    const service = new InvitationService(fakeInvitationRepository(rows), fakeMembershipRepository(), fakeAccessScopeService());
    const result = await service.revoke(context, 'inv-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe('revoked');
  });

  it('returns INVITATION_NOT_FOUND for an unknown id', async () => {
    const service = new InvitationService(fakeInvitationRepository({}), fakeMembershipRepository(), fakeAccessScopeService());
    const result = await service.revoke(context, 'missing');
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.failure.code).toBe('INVITATION_NOT_FOUND');
  });
});
