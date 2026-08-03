import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityModule } from './identity.module';
import { InvitationController } from './invitation.controller';
import { MembershipController } from './membership.controller';
import { SupportAccessGrantController } from './support-access-grant.controller';
import { RequestWithIdentity } from './resolve-tenant-context.util';

/**
 * WP-006 §7: "full invite → accept → active → suspend → reinstate → revoke
 * flow through the actual HTTP endpoints" plus a support-access grant
 * creation + expiry test. Boots the real `IdentityModule` through Nest's DI
 * container (proving the module wiring itself, not just each service in
 * isolation) against an in-memory fake `PrismaService` — this never opens a
 * real database connection, so it is safe to run in any environment
 * `npm test` runs in, including this repo's own `.env` pointed at a real
 * Supabase instance. Controllers are called directly (house style in this
 * codebase — see `sales.controller.spec.ts` — has no supertest/HTTP-server
 * layer in tests); `@Envelope`/`@RequiresIdempotencyKey` decorators are
 * exercised at the metadata level by the dedicated `common/http` specs, so
 * this suite focuses on proving the actual identity/membership/permission
 * business flow end-to-end through real controller → service → repository
 * code paths.
 */

const TENANT_ID = randomUUID();
const OWNER_IDENTITY_ID = randomUUID();
const OWNER_MEMBERSHIP_ID = randomUUID();

function makeReq(identityId: string): RequestWithIdentity {
  return {
    user: { sub: identityId },
    requestId: `req-${randomUUID()}`,
    correlationId: `corr-${randomUUID()}`,
  } as unknown as RequestWithIdentity;
}

/** A minimal, in-memory stand-in for the subset of PrismaClient this WP's repositories call. */
class FakePrismaService {
  tenants = new Map<string, any>([[TENANT_ID, { id: TENANT_ID, access_mode: 'active' }]]);
  memberships = new Map<string, any>([
    [
      OWNER_MEMBERSHIP_ID,
      {
        id: OWNER_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        identityId: OWNER_IDENTITY_ID,
        role: 'tenant_owner',
        status: 'active',
        created_at: new Date(),
      },
    ],
  ]);
  accessScopeAssignments = new Map<string, any>();
  invitations = new Map<string, any>();
  permissionPolicySnapshots = new Map<string, any>();
  supportAccessGrants = new Map<string, any>();

  tenant = {
    findUnique: async ({ where }: any) => this.tenants.get(where.id) ?? null,
  };

  membership = {
    findFirst: async ({ where }: any) => {
      const rows = [...this.memberships.values()];
      return (
        rows.find(
          (m) =>
            (!where.id || m.id === where.id) &&
            (!where.tenantId || m.tenantId === where.tenantId) &&
            (!where.identityId || m.identityId === where.identityId) &&
            (!where.status || m.status === where.status),
        ) ?? null
      );
    },
    findUnique: async ({ where, include }: any) => {
      let row: any = null;
      if (where.identityId_tenantId) {
        const { identityId, tenantId } = where.identityId_tenantId;
        row = [...this.memberships.values()].find((m) => m.identityId === identityId && m.tenantId === tenantId) ?? null;
      } else {
        row = this.memberships.get(where.id) ?? null;
      }
      if (row && include?.access_scope_assignments) {
        return {
          ...row,
          access_scope_assignments: [...this.accessScopeAssignments.values()].filter((a) => a.membership_id === row.id),
        };
      }
      return row;
    },
    findMany: async ({ where }: any) =>
      [...this.memberships.values()].filter(
        (m) =>
          m.tenantId === where.tenantId &&
          (!where.status || m.status === where.status) &&
          (!where.role || m.role === where.role),
      ),
    count: async ({ where }: any) =>
      [...this.memberships.values()].filter((m) => m.tenantId === where.tenantId && m.role === where.role && m.status === where.status)
        .length,
    create: async ({ data }: any) => {
      const id = randomUUID();
      const row = { id, ...data, created_at: new Date(), updated_at: new Date() };
      this.memberships.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = { ...this.memberships.get(where.id), ...data, updated_at: new Date() };
      this.memberships.set(where.id, row);
      return row;
    },
  };

  accessScopeAssignment = {
    findFirst: async ({ where }: any) => {
      const rows = [...this.accessScopeAssignments.values()];
      return (
        rows.find((a) => (!where.id || a.id === where.id) && (!where.membership || this.memberships.get(a.membership_id)?.tenantId === where.membership.tenantId)) ??
        null
      );
    },
    findMany: async ({ where }: any) =>
      [...this.accessScopeAssignments.values()].filter(
        (a) =>
          this.memberships.get(a.membership_id)?.tenantId === where.membership.tenantId &&
          (!where.membership_id || a.membership_id === where.membership_id) &&
          (!where.effective_to || a.effective_to === null),
      ),
    create: async ({ data }: any) => {
      const id = randomUUID();
      const row = { id, ...data, effective_from: new Date(), effective_to: null, created_at: new Date() };
      this.accessScopeAssignments.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = { ...this.accessScopeAssignments.get(where.id), ...data };
      this.accessScopeAssignments.set(where.id, row);
      return row;
    },
  };

  invitation = {
    findFirst: async ({ where }: any) =>
      [...this.invitations.values()].find(
        (i) =>
          (!where.id || i.id === where.id) &&
          i.tenant_id === where.tenant_id &&
          (!where.email || i.email === where.email) &&
          (!where.status || i.status === where.status),
      ) ?? null,
    findUnique: async ({ where }: any) => [...this.invitations.values()].find((i) => i.token_hash === where.token_hash) ?? null,
    findMany: async ({ where }: any) => [...this.invitations.values()].filter((i) => i.tenant_id === where.tenant_id),
    create: async ({ data }: any) => {
      const id = randomUUID();
      const row = { id, ...data, status: 'pending', created_at: new Date(), updated_at: new Date() };
      this.invitations.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = { ...this.invitations.get(where.id), ...data, updated_at: new Date() };
      this.invitations.set(where.id, row);
      return row;
    },
  };

  permissionPolicySnapshot = {
    findFirst: async ({ where }: any) => {
      const rows = [...this.permissionPolicySnapshots.values()].filter((s) => (!where.is_active ? true : s.is_active === where.is_active));
      return rows.sort((a, b) => b.version - a.version)[0] ?? null;
    },
    create: async ({ data }: any) => {
      const id = randomUUID();
      const row = { id, ...data, created_at: new Date() };
      this.permissionPolicySnapshots.set(id, row);
      return row;
    },
  };

  supportAccessGrant = {
    findFirst: async ({ where }: any) =>
      [...this.supportAccessGrants.values()].find((g) => (!where.id || g.id === where.id) && g.tenant_id === where.tenant_id) ?? null,
    findMany: async ({ where }: any) => [...this.supportAccessGrants.values()].filter((g) => g.tenant_id === where.tenant_id),
    create: async ({ data }: any) => {
      const id = randomUUID();
      const row = { id, ...data, revoked_at: null, starts_at: new Date(), created_at: new Date() };
      this.supportAccessGrants.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = { ...this.supportAccessGrants.get(where.id), ...data };
      this.supportAccessGrants.set(where.id, row);
      return row;
    },
  };
}

describe('WP-006 identity module — full HTTP-endpoint integration flow', () => {
  let fakePrisma: FakePrismaService;
  let membershipController: MembershipController;
  let invitationController: InvitationController;
  let supportAccessGrantController: SupportAccessGrantController;

  beforeEach(async () => {
    fakePrisma = new FakePrismaService();
    const moduleRef = await Test.createTestingModule({
      imports: [IdentityModule, PrismaModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();

    membershipController = moduleRef.get(MembershipController);
    invitationController = moduleRef.get(InvitationController);
    supportAccessGrantController = moduleRef.get(SupportAccessGrantController);

    await moduleRef.init();
  });

  it('invite -> accept -> active -> suspend -> reinstate -> revoke (deactivate), through the real controllers', async () => {
    const ownerReq = makeReq(OWNER_IDENTITY_ID);

    // invite
    const createResult = await invitationController.create(
      TENANT_ID,
      { email: 'newhire@example.com', role: 'cashier', scope_type: 'tenant_wide' } as any,
      ownerReq,
    );
    expect(createResult.invitation.status).toBe('pending');
    const rawToken = createResult.token;

    // accept, as a brand-new identity with no prior Membership
    const newIdentityId = randomUUID();
    const membership = await invitationController.accept({ token: rawToken } as any, makeReq(newIdentityId));
    expect(membership.status).toBe('active');
    expect(membership.role).toBe('cashier');

    // active -> suspend
    const suspended = await membershipController.suspend(TENANT_ID, membership.id, ownerReq);
    expect(suspended.status).toBe('suspended');

    // suspended -> reinstate (active)
    const reinstated = await membershipController.reinstate(TENANT_ID, membership.id, ownerReq);
    expect(reinstated.status).toBe('active');

    // active -> deactivate ("revoke" access permanently)
    const deactivated = await membershipController.deactivate(TENANT_ID, membership.id, ownerReq);
    expect(deactivated.status).toBe('deactivated');

    // a subsequent invalid transition is rejected, not silently accepted
    await expect(membershipController.suspend(TENANT_ID, membership.id, ownerReq)).rejects.toMatchObject({
      code: 'MEMBERSHIP_INVALID_STATE_TRANSITION',
    });
  });

  it('the last-owner safeguard blocks suspending the sole active Tenant Owner through the real controller', async () => {
    const ownerReq = makeReq(OWNER_IDENTITY_ID);
    await expect(membershipController.suspend(TENANT_ID, OWNER_MEMBERSHIP_ID, ownerReq)).rejects.toMatchObject({
      code: 'LAST_OWNER_SAFEGUARD_VIOLATION',
    });
  });

  it('the last-owner safeguard allows suspension once a second active Owner exists', async () => {
    const ownerReq = makeReq(OWNER_IDENTITY_ID);

    const createResult = await invitationController.create(
      TENANT_ID,
      { email: 'co-owner@example.com', role: 'tenant_owner', scope_type: 'tenant_wide' } as any,
      ownerReq,
    );
    const secondOwnerIdentityId = randomUUID();
    await invitationController.accept({ token: createResult.token } as any, makeReq(secondOwnerIdentityId));

    const suspended = await membershipController.suspend(TENANT_ID, OWNER_MEMBERSHIP_ID, ownerReq);
    expect(suspended.status).toBe('suspended');
  });

  it('rejects an invitation with no scope_type through the real HTTP validation path (BR-SCP-101)', async () => {
    const ownerReq = makeReq(OWNER_IDENTITY_ID);
    await expect(
      invitationController.create(TENANT_ID, { email: 'x@example.com', role: 'cashier', scope_type: null } as any, ownerReq),
    ).rejects.toMatchObject({ code: 'ACCESS_SCOPE_REQUIRED' });
  });

  it('rejects acceptance of an expired invitation', async () => {
    const ownerReq = makeReq(OWNER_IDENTITY_ID);
    const createResult = await invitationController.create(
      TENANT_ID,
      { email: 'late@example.com', role: 'seller', scope_type: 'tenant_wide' } as any,
      ownerReq,
    );
    const invitationRow = [...fakePrisma.invitations.values()].find((i) => i.email === 'late@example.com');
    invitationRow.expires_at = new Date(Date.now() - 1000);

    await expect(
      invitationController.accept({ token: createResult.token } as any, makeReq(randomUUID())),
    ).rejects.toMatchObject({ code: 'INVITATION_EXPIRED' });
  });

  it('support-access grant: creation, active check, and expiry through the real controller', async () => {
    const ownerReq = makeReq(OWNER_IDENTITY_ID);

    const grant = await supportAccessGrantController.create(
      TENANT_ID,
      {
        operator_identity_id: randomUUID(),
        mode: 'metadata_only',
        purpose: 'health check',
        scopes: [],
        reason: 'routine operational check',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      } as any,
      ownerReq,
    );
    expect(grant.tenant_id).toBe(TENANT_ID);
    expect(grant.revoked_at).toBeNull();

    // Manually age the grant past expiry to prove expiry is enforced, not just recorded.
    const stored = fakePrisma.supportAccessGrants.get(grant.id);
    stored.expires_at = new Date(Date.now() - 1000);
    fakePrisma.supportAccessGrants.set(grant.id, stored);

    const revoked = await supportAccessGrantController.revoke(TENANT_ID, grant.id, ownerReq);
    expect(revoked.revoked_at).not.toBeNull();
  });

  it('rejects a Support Access grant beyond metadata-only with no consent recorded (BR-SUPA-101)', async () => {
    const ownerReq = makeReq(OWNER_IDENTITY_ID);
    await expect(
      supportAccessGrantController.create(
        TENANT_ID,
        {
          operator_identity_id: randomUUID(),
          mode: 'read_only_diagnostic',
          purpose: 'investigate ticket',
          scopes: ['tenant_wide'],
          reason: 'customer ticket #42',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          consent_obtained: false,
        } as any,
        ownerReq,
      ),
    ).rejects.toMatchObject({ code: 'SUPPORT_ACCESS_CONSENT_REQUIRED' });
  });
});
