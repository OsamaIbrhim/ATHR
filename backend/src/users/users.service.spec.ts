import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

describe('UsersService', () => {
  const ctx = contextFor(TENANT_A);
  const owner = actorFor('tenant_owner', { sub: 'owner-id', tenantWide: true });
  const manager = actorFor('location_manager', { sub: 'manager-id', branchId: 'branch-1' });

  const repository = {
    save: jest.fn(),
    list: jest.fn(),
    findMembership: jest.fn(),
    updatePermissions: jest.fn(),
  };
  const service = new UsersService(repository as unknown as UsersRepository);
  const newUser = {
    name: 'Cashier',
    phone: '01012345678',
    password: 'password123',
    role: 'cashier' as const,
  };

  beforeEach(() => {
    Object.values(repository).forEach((fn) => fn.mockReset());
    repository.save.mockResolvedValue({ id: 'user-id' });
  });

  describe('create', () => {
    it('rejects a user without a phone before hashing or persistence', async () => {
      await expect(service.create(ctx, {
        name: 'Email Only', email: 'email-only@example.com', password: 'password123', role: 'cashier',
      } as any, owner)).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('normalizes the phone before persistence and writes the Membership role and branch scope', async () => {
      await service.create(ctx, { ...newUser, phone: '010 1234 5678', branch_id: 'branch-1' }, owner);
      expect(repository.save).toHaveBeenCalledWith(ctx, {
        user: expect.objectContaining({ phone: '01012345678', name: 'Cashier', is_active: true }),
        role: 'cashier',
        branchId: 'branch-1',
      });
      // The password is stored hashed, never as given.
      expect(repository.save.mock.calls[0][1].user.password_hash).not.toBe('password123');
    });

    it('gives a warehouse manager without a branch a tenant-wide scope, other roles none', async () => {
      await service.create(ctx, { ...newUser, role: 'warehouse_manager' }, owner);
      expect(repository.save.mock.calls[0][1].branchId).toBeNull();
      await service.create(ctx, newUser, owner);
      expect(repository.save.mock.calls[1][1].branchId).toBeUndefined();
    });

    it('never creates an owner through the users API', async () => {
      await expect(service.create(ctx, { ...newUser, role: 'tenant_owner' }, owner))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a branch manager add subordinates only inside their own branch', async () => {
      await service.create(ctx, { ...newUser, branch_id: 'branch-1' }, manager);
      expect(repository.save).toHaveBeenCalledTimes(1);

      await expect(service.create(ctx, { ...newUser, branch_id: 'branch-2' }, manager))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.create(ctx, newUser, manager)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.create(ctx, { ...newUser, role: 'location_manager', branch_id: 'branch-1' }, manager))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('findAll', () => {
    it('shows a tenant-wide actor everyone except owners', async () => {
      repository.list.mockResolvedValue([]);
      await service.findAll(ctx, owner);
      expect(repository.list).toHaveBeenCalledWith(ctx, { role: { not: 'tenant_owner' } });
    });

    it('shows a branch manager only subordinates scoped to their branch', async () => {
      repository.list.mockResolvedValue([]);
      await service.findAll(ctx, manager);
      expect(repository.list).toHaveBeenCalledWith(ctx, {
        role: { in: ['cashier', 'warehouse_manager', 'seller'] },
        access_scope_assignments: { some: { scope_type: 'location', scope_ref_id: 'branch-1' } },
      });
    });

    it('shows nothing to a scoped actor with no branch', async () => {
      expect(await service.findAll(ctx, actorFor('location_manager'))).toEqual([]);
      expect(repository.list).not.toHaveBeenCalled();
    });
  });

  describe('updatePermissions', () => {
    const target = {
      membership_id: 'm-1', role: 'cashier' as const, branch_id: 'branch-1',
      granted_permissions: [] as string[], revoked_permissions: [] as string[],
    };

    it('rejects a permission that is both granted and revoked', async () => {
      repository.findMembership.mockResolvedValue(target);
      await expect(service.updatePermissions(ctx, 'u-1', {
        granted_permissions: ['pricing.cost.view'], revoked_permissions: ['pricing.cost.view'],
      }, owner)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does not let an actor grant a permission they do not hold themselves', async () => {
      repository.findMembership.mockResolvedValue(target);
      // A manager whose own `pricing.cost.view` was revoked cannot hand it out.
      const limited = actorFor('location_manager', { branchId: 'branch-1', revoked: ['pricing.cost.view'] });
      await expect(service.updatePermissions(ctx, 'u-1', {
        granted_permissions: ['pricing.cost.view'], revoked_permissions: [],
      }, limited)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stores the overrides and returns the resulting effective permissions', async () => {
      repository.findMembership.mockResolvedValue(target);
      repository.updatePermissions.mockResolvedValue({
        ...target, granted_permissions: ['pricing.cost.view'], revoked_permissions: ['sales.sale.create'],
      });
      const result = await service.updatePermissions(ctx, 'u-1', {
        granted_permissions: ['pricing.cost.view'], revoked_permissions: ['sales.sale.create'],
      }, owner);
      expect(repository.updatePermissions).toHaveBeenCalledWith(ctx, 'u-1', ['pricing.cost.view'], ['sales.sale.create']);
      expect(result.permissions).toContain('pricing.cost.view');
      expect(result.permissions).toContain('sales.sale.view');
      expect(result.permissions).not.toContain('sales.sale.create');
    });

    it('a branch manager cannot change a user of another branch or another manager', async () => {
      repository.findMembership.mockResolvedValue({ ...target, branch_id: 'branch-2' });
      await expect(service.updatePermissions(ctx, 'u-1', { granted_permissions: [], revoked_permissions: [] }, manager))
        .rejects.toBeInstanceOf(ForbiddenException);
      repository.findMembership.mockResolvedValue({ ...target, role: 'location_manager' });
      await expect(service.updatePermissions(ctx, 'u-1', { granted_permissions: [], revoked_permissions: [] }, manager))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
