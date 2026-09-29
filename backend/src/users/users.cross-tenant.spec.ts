import { randomUUID } from 'crypto';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * Cross-tenant isolation for the `users` module.
 *
 * `User` has no `tenant_id` by design (it is the global identity), so isolation
 * here is proved through the Membership, which carries the tenant.
 */

const USER_A = randomUUID();
const USER_B = randomUUID();

function staff(id: string, tenantId: string, name: string) {
  return {
    id: randomUUID(),
    tenant_id: tenantId,
    user_id: id,
    role: 'cashier',
    status: 'active',
    granted_permissions: [],
    revoked_permissions: [],
    access_scope_assignments: [],
    user: { id, name, phone: null, email: null, is_active: true, created_at: new Date() },
  };
}

function setup() {
  const prisma = fakePrisma({
    membership: [staff(USER_A, TENANT_A, 'A Cashier'), staff(USER_B, TENANT_B, 'B Cashier')],
  });
  const repository = new UsersRepository(prisma);
  return { prisma, repository, service: new UsersService(repository) };
}

const tenantWideOwner = actorFor('tenant_owner', { tenantWide: true });

describe('users — cross-tenant isolation', () => {
  it('lists only users with a Membership in the calling tenant', async () => {
    const { service } = setup();
    expect((await service.findAll(contextFor(TENANT_A), tenantWideOwner)).map((row) => row.id)).toEqual([USER_A]);
    expect((await service.findAll(contextFor(TENANT_B), tenantWideOwner)).map((row) => row.id)).toEqual([USER_B]);
  });

  it('does not resolve a user from another tenant', async () => {
    const { repository } = setup();
    expect(await repository.findMembership(contextFor(TENANT_B), USER_A)).toBeNull();
    expect(await repository.findMembership(contextFor(TENANT_A), USER_A)).not.toBeNull();
  });

  it('refuses to change another tenant\'s user permissions', async () => {
    const { service, prisma } = setup();
    await expect(
      service.updatePermissions(
        contextFor(TENANT_B),
        USER_A,
        { granted_permissions: ['pricing.cost.view'], revoked_permissions: [] },
        tenantWideOwner,
      ),
    ).rejects.toThrow('User not found');
    expect(prisma.membership.rows.find((row: any) => row.user_id === USER_A).granted_permissions).toEqual([]);
  });

  it('updates permissions on the Membership of the calling tenant only', async () => {
    const { service, prisma } = setup();
    const result = await service.updatePermissions(
      contextFor(TENANT_A),
      USER_A,
      { granted_permissions: ['pricing.cost.view'], revoked_permissions: ['sales.sale.create'] },
      tenantWideOwner,
    );
    expect(result.permissions).toContain('pricing.cost.view');
    expect(result.permissions).not.toContain('sales.sale.create');
    expect(prisma.membership.rows.find((row: any) => row.user_id === USER_A).granted_permissions).toEqual(['pricing.cost.view']);
    expect(prisma.membership.rows.find((row: any) => row.user_id === USER_B).granted_permissions).toEqual([]);
  });

  /**
   * Without a Membership a new account would authenticate but resolve no
   * TenantContext, so the global guard would deny every one of its requests.
   */
  it('creates the Membership and access scope in the calling tenant alongside the user', async () => {
    const userId = randomUUID();
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: userId }) },
      membership: {
        create: jest.fn().mockResolvedValue({ id: 'membership-id' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...staff(userId, TENANT_B, 'New'),
          role: 'location_manager',
          access_scope_assignments: [
            { scope_type: 'location', scope_ref_id: 'branch-1', effective_from: new Date('2020-01-01'), effective_to: null },
          ],
        }),
      },
      accessScopeAssignment: { create: jest.fn().mockResolvedValue({}) },
    };
    const repository = new UsersRepository({ $transaction: (fn: any) => fn(tx) } as any);

    const created = await repository.save(contextFor(TENANT_B), {
      user: { name: 'New', password_hash: 'x', is_active: true },
      role: 'location_manager',
      branchId: 'branch-1',
    });

    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { tenant_id: TENANT_B, user_id: userId, role: 'location_manager', status: 'active' },
    });
    expect(tx.accessScopeAssignment.create).toHaveBeenCalledWith({
      data: { membership_id: 'membership-id', scope_type: 'location', scope_ref_id: 'branch-1', grant_source: 'user_admin' },
    });
    expect(created).toMatchObject({ role: 'location_manager', branch_id: 'branch-1' });
  });
});
