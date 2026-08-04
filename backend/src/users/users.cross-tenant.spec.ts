import { randomUUID } from 'crypto';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-007 Phase A §A.3.6 — cross-tenant isolation for the `users` module.
 *
 * `User` has no `tenant_id` column by design (ADR-0003: it is the global
 * Platform Identity), so isolation here is proved through the Membership
 * join rather than a column predicate.
 */

const USER_A = randomUUID();
const USER_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    user: [
      {
        id: USER_A,
        name: 'A Cashier',
        role: 'cashier',
        branch_id: null,
        is_active: true,
        granted_capabilities: [],
        revoked_capabilities: [],
        memberships: [{ tenantId: TENANT_A }],
      },
      {
        id: USER_B,
        name: 'B Cashier',
        role: 'cashier',
        branch_id: null,
        is_active: true,
        granted_capabilities: [],
        revoked_capabilities: [],
        memberships: [{ tenantId: TENANT_B }],
      },
    ],
    membership: [],
  });

  // `memberships: { some: { tenantId } }` is a to-many filter; evaluate it
  // against the embedded array the fixtures carry.
  const originalMatch = prisma.user.findMany;
  const scoped = (rows: any[], where: any) =>
    rows.filter((row) => {
      const tenantId = where?.memberships?.some?.tenantId;
      if (tenantId && !row.memberships.some((m: any) => m.tenantId === tenantId)) return false;
      if (where?.role?.not && row.role === where.role.not) return false;
      if (where?.role?.in && !where.role.in.includes(row.role)) return false;
      return true;
    });
  prisma.user.findMany = async ({ where }: any) => scoped(prisma.user.rows, where);
  prisma.user.findFirst = async ({ where }: any) =>
    scoped(prisma.user.rows, where).find((row: any) => row.id === where.id) ?? null;
  void originalMatch;

  const repository = new UsersRepository(prisma);
  return { prisma, repository, service: new UsersService(repository) };
}

const ownerActor = { sub: randomUUID(), role: 'owner', branch_id: null, capabilities: [] } as any;

describe('users — cross-tenant isolation', () => {
  it('lists only identities with a Membership in the calling tenant', async () => {
    const { service } = setup();
    expect((await service.findAll(contextFor(TENANT_A), ownerActor)).map((row: any) => row.id)).toEqual([
      USER_A,
    ]);
    expect((await service.findAll(contextFor(TENANT_B), ownerActor)).map((row: any) => row.id)).toEqual([
      USER_B,
    ]);
  });

  it('does not resolve an identity from another tenant', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_B), USER_A)).toBeNull();
    expect(await repository.findById(contextFor(TENANT_A), USER_A)).not.toBeNull();
  });

  it('refuses to change another tenant\'s user permissions', async () => {
    const { service } = setup();
    await expect(
      service.updatePermissions(
        contextFor(TENANT_B),
        USER_A,
        { granted_capabilities: [], revoked_capabilities: [] } as any,
        ownerActor,
      ),
    ).rejects.toThrow('User not found');
  });

  /**
   * Without a Membership a new account would authenticate but resolve no
   * TenantContext, so the global guard would deny every one of its requests.
   */
  it('creates a Membership in the calling tenant alongside the identity', async () => {
    const { repository, prisma } = setup();
    const created: any = await repository.save(contextFor(TENANT_B), {
      name: 'New',
      role: 'cashier',
      is_active: true,
      password_hash: 'x',
    } as any);

    expect(prisma.membership.rows).toHaveLength(1);
    expect(prisma.membership.rows[0]).toMatchObject({
      tenantId: TENANT_B,
      identityId: created.id,
      role: 'cashier',
      status: 'active',
    });
  });

  it('maps the legacy Role enum onto the migration\'s MembershipRole', async () => {
    const { repository, prisma } = setup();
    await repository.save(contextFor(TENANT_A), {
      name: 'Manager',
      role: 'branch_manager',
      is_active: true,
      password_hash: 'x',
    } as any);
    expect(prisma.membership.rows[0].role).toBe('location_manager');
  });
});
