import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// WP-007 Phase A: `create` now also writes the Membership that lets the new
// account resolve a TenantContext, so the prisma double provides a
// `$transaction` and a `membership.create`. Assertions are otherwise unchanged.
describe('UsersService', () => {
  const create = jest.fn();
  const membershipCreate = jest.fn();
  const ctx = contextFor(TENANT_A);
  const actor = {
    sub: 'owner-id',
    role: Role.owner,
    branch_id: null,
    capabilities: ['users.manage'],
  } as any;
  const prisma = {
    user: { create },
    membership: { create: membershipCreate },
    $transaction: async (fn: any) => fn(prisma),
  } as any;
  const service = new UsersService(new UsersRepository(prisma));

  beforeEach(() => {
    create.mockReset();
    membershipCreate.mockReset();
  });

  it('rejects a user without a phone before hashing or persistence', async () => {
    await expect(service.create(ctx, {
      name: 'Email Only',
      email: 'email-only@example.com',
      password: 'password123',
      role: Role.cashier,
    } as any, actor)).rejects.toBeInstanceOf(BadRequestException);

    expect(create).not.toHaveBeenCalled();
  });

  it('normalizes the phone before persistence', async () => {
    create.mockResolvedValue({ id: 'user-id', role: Role.cashier, is_active: true });

    await service.create(ctx, {
      name: 'Cashier',
      phone: '010 1234 5678',
      password: 'password123',
      role: Role.cashier,
    } as any, actor);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        phone: '01012345678',
      }),
    }));
  });

  it('creates the Membership that makes the new account usable', async () => {
    create.mockResolvedValue({ id: 'user-id', role: Role.cashier, is_active: true });

    await service.create(ctx, {
      name: 'Cashier',
      phone: '01012345678',
      password: 'password123',
      role: Role.cashier,
    } as any, actor);

    expect(membershipCreate).toHaveBeenCalledWith({
      data: {
        tenantId: ctx.tenantId,
        identityId: 'user-id',
        role: 'cashier',
        status: 'active',
      },
    });
  });
});
