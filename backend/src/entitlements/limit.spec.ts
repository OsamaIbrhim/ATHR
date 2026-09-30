import { BranchesService } from '../branches/branches.service';
import { actorFor } from '../auth/testing/actors';
import { contextFor, TENANT_A, TENANT_B } from '../identity/testing/cross-tenant-harness';
import { ProductsService } from '../products/products.service';
import { TerminalsRepository } from '../terminals/terminals.repository';
import { TerminalsService } from '../terminals/terminals.service';
import { UsersService } from '../users/users.service';
import { fullAccess } from './testing';
import { LimitService } from './limit.service';
import { EntitlementService } from './entitlement.service';

const ctx = contextFor(TENANT_A);

describe('LimitService', () => {
  function setup(limits: Record<string, number | null>, counts: Partial<Record<'branch' | 'posTerminal' | 'membership' | 'product', number>>) {
    const count = (n = 0) => jest.fn(async () => n);
    const prisma: any = {
      branch: { count: count(counts.branch) },
      posTerminal: { count: count(counts.posTerminal) },
      membership: { count: count(counts.membership) },
      product: { count: count(counts.product) },
    };
    const entitlements = { resolve: async () => ({ limits }) } as unknown as EntitlementService;
    return { prisma, limits: new LimitService(prisma, entitlements) };
  }

  it.each([
    ['branches', 'branch', { branches: 1 }],
    ['terminals', 'posTerminal', { terminals: 2 }],
    ['users', 'membership', { users: 3 }],
    ['products', 'product', { products: 10 }],
  ] as const)('blocks creating another %s once the plan limit is reached, reporting limit and current', async (key, model, limit) => {
    const max = Object.values(limit)[0];
    const { limits } = setup(limit, { [model]: max });
    await expect(limits.assertCanCreate(TENANT_A, key)).rejects.toMatchObject({
      code: 'ENTITLEMENT_LIMIT_REACHED',
      overrides: { data: { limit_key: key, limit: max, current: max } },
    });
  });

  it('allows creation below the limit', async () => {
    const { limits } = setup({ branches: 3 }, { branch: 2 });
    await expect(limits.assertCanCreate(TENANT_A, 'branches')).resolves.toBeUndefined();
  });

  it('a missing or null limit is unlimited and does not even count', async () => {
    const { limits, prisma } = setup({ users: null }, { membership: 999, branch: 999 });
    await expect(limits.assertCanCreate(TENANT_A, 'users')).resolves.toBeUndefined();
    await expect(limits.assertCanCreate(TENANT_A, 'branches')).resolves.toBeUndefined();
    expect(prisma.membership.count).not.toHaveBeenCalled();
    expect(prisma.branch.count).not.toHaveBeenCalled();
  });

  it('a downgrade below current usage only blocks creating more, never existing data', async () => {
    const { limits, prisma } = setup({ branches: 1 }, { branch: 5 });
    await expect(limits.assertCanCreate(TENANT_A, 'branches')).rejects.toMatchObject({ code: 'ENTITLEMENT_LIMIT_REACHED' });
    expect(Object.keys(prisma.branch)).toEqual(['count']);
  });

  it('counts only the tenant\'s own in-use rows, using the given transaction client when there is one', async () => {
    const { limits, prisma } = setup({ terminals: 5, users: 5, branches: 5, products: 5 }, {});
    const tx: any = { posTerminal: { count: jest.fn(async () => 0) } };
    await limits.assertCanCreate(TENANT_B, 'terminals', tx);
    expect(tx.posTerminal.count).toHaveBeenCalledWith({ where: { tenant_id: TENANT_B, is_revoked: false } });
    expect(prisma.posTerminal.count).not.toHaveBeenCalled();

    await limits.assertCanCreate(TENANT_B, 'users');
    await limits.assertCanCreate(TENANT_B, 'branches');
    await limits.assertCanCreate(TENANT_B, 'products');
    expect(prisma.membership.count).toHaveBeenCalledWith({ where: { tenant_id: TENANT_B, status: { notIn: ['deactivated', 'expired'] } } });
    expect(prisma.branch.count).toHaveBeenCalledWith({ where: { tenant_id: TENANT_B, is_active: true } });
    expect(prisma.product.count).toHaveBeenCalledWith({ where: { tenant_id: TENANT_B, is_active: true } });
  });

  it('headroom says how many more a bulk creation may add, without touching existing data', async () => {
    expect(await setup({ products: 10 }, { product: 4 }).limits.headroom(TENANT_A, 'products')).toEqual({ limit: 10, current: 4, remaining: 6 });
    expect(await setup({ products: 3 }, { product: 5 }).limits.headroom(TENANT_A, 'products')).toEqual({ limit: 3, current: 5, remaining: 0 });
    expect(await setup({ products: null }, { product: 5 }).limits.headroom(TENANT_A, 'products')).toEqual({ limit: null, current: 5, remaining: null });
  });

  it('usage reports every limited resource', async () => {
    const { limits } = setup({}, { branch: 1, posTerminal: 2, membership: 3, product: 4 });
    expect(await limits.usage(TENANT_A)).toEqual({ branches: 1, terminals: 2, users: 3, products: 4 });
  });
});

/** Each creation point asks the LimitService first and creates nothing when it says no. */
describe('limits at the creation points', () => {
  const reached = Object.assign(new Error('limit reached'), { code: 'ENTITLEMENT_LIMIT_REACHED' });
  const limitService = () => ({ assertCanCreate: jest.fn().mockRejectedValue(reached) }) as any;
  const owner = actorFor('tenant_owner', { sub: 'owner', tenantWide: true });

  it('branch create', async () => {
    const repository = { save: jest.fn() } as any;
    const limits = limitService();
    await expect(new BranchesService(repository, limits).create(ctx, { code: 'B2', name_ar: 'ب' } as any)).rejects.toBe(reached);
    expect(limits.assertCanCreate).toHaveBeenCalledWith(TENANT_A, 'branches');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('product create', async () => {
    const repository = { createProduct: jest.fn() } as any;
    const limits = limitService();
    const service = new ProductsService(repository, {} as any, {} as any, limits, {} as any, {} as any);
    await expect(service.createProduct(ctx, { name_en: 'x' } as any)).rejects.toBe(reached);
    expect(limits.assertCanCreate).toHaveBeenCalledWith(TENANT_A, 'products');
    expect(repository.createProduct).not.toHaveBeenCalled();
  });

  it('user create', async () => {
    const repository = { save: jest.fn() } as any;
    const limits = limitService();
    const dto = { name: 'Cashier', phone: '01012345678', password: 'password123', role: 'cashier' as const };
    await expect(new UsersService(repository, limits).create(ctx, dto, owner)).rejects.toBe(reached);
    expect(limits.assertCanCreate).toHaveBeenCalledWith(TENANT_A, 'users');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('terminal enrollment code', async () => {
    const prisma: any = {
      branch: { findFirst: async () => ({ id: 'branch-1', code: 'MAIN', name_ar: 'ر', name_en: 'M' }) },
      posTerminalEnrollment: { create: jest.fn() },
    };
    const limits = limitService();
    const service = new TerminalsService(prisma, new TerminalsRepository(prisma), fullAccess, limits);
    const manager = actorFor('location_manager', { sub: 'm', branchId: 'branch-1' });
    await expect(service.createEnrollment(ctx, { name: 'Till' }, manager)).rejects.toBe(reached);
    expect(limits.assertCanCreate).toHaveBeenCalledWith(TENANT_A, 'terminals');
    expect(prisma.posTerminalEnrollment.create).not.toHaveBeenCalled();
  });

  describe('terminal enrollment (device)', () => {
    function enrolling(existingTerminal: unknown) {
      const enrollment = {
        id: 'e1', branch_id: 'branch-1', tenant_id: TENANT_A, created_by: 'm', terminal_name: 'Till',
        used_at: null, expires_at: new Date(Date.now() + 60_000), branch: { id: 'branch-1', tenant_id: TENANT_A },
      };
      const tx = {
        posTerminalEnrollment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        posTerminal: { upsert: jest.fn().mockResolvedValue({ id: 't1', branch: {} }) },
      };
      const prisma: any = {
        posTerminalEnrollment: { findUnique: async () => enrollment },
        posTerminal: { findUnique: async () => existingTerminal },
        $transaction: (callback: any) => callback(tx),
      };
      return { tx, prisma };
    }
    const device = { enrollment_code: 'ABCDEF123456', device_id: '93de7eb8-4fbe-4f78-8c83-2fefea327ffc' };

    it('a new device counts against the limit, inside the enrolling transaction', async () => {
      const { tx, prisma } = enrolling(null);
      const limits = limitService();
      await expect(new TerminalsService(prisma, new TerminalsRepository(prisma), fullAccess, limits).enroll(device)).rejects.toBe(reached);
      expect(limits.assertCanCreate).toHaveBeenCalledWith(TENANT_A, 'terminals', tx);
      expect(tx.posTerminal.upsert).not.toHaveBeenCalled();
    });

    it('re-enrolling a known device does not use another slot', async () => {
      const { prisma } = enrolling({ id: 't1', branch_id: 'branch-1', is_revoked: false });
      const limits = limitService();
      await expect(new TerminalsService(prisma, new TerminalsRepository(prisma), fullAccess, limits).enroll(device)).resolves.toBeDefined();
      expect(limits.assertCanCreate).not.toHaveBeenCalled();
    });

    it('a suspended tenant cannot enroll a device', async () => {
      const { prisma } = enrolling(null);
      const suspended = { assertCanWrite: jest.fn().mockRejectedValue(new Error('TENANT_SUSPENDED')) } as any;
      await expect(new TerminalsService(prisma, new TerminalsRepository(prisma), suspended, limitService()).enroll(device)).rejects.toThrow('TENANT_SUSPENDED');
    });
  });
});

describe('POS heartbeat reports the subscription', () => {
  it('returns mode, grace_until and plan_code for the terminal\'s tenant', async () => {
    const graceUntil = new Date('2026-10-08');
    const entitlements = { resolve: jest.fn(async () => ({ mode: 'grace', graceUntil, planCode: 'pro' })) } as any;
    const terminal = { id: 't1', tenant_id: TENANT_A, branch_id: 'branch-1', is_revoked: false };
    const hash = require('crypto').createHash('sha256').update('secret').digest('hex');
    const prisma: any = {
      posTerminal: {
        findUnique: async () => ({ ...terminal, device_token_hash: hash }),
        update: async () => terminal,
      },
    };
    const service = new TerminalsService(prisma, new TerminalsRepository(prisma), entitlements, {} as any);
    const cashier = actorFor('cashier', { sub: 'c', tenantId: TENANT_A, branchId: 'branch-1' });
    const result = await service.heartbeat({ device_id: 'd', sync_status: 'success', pending_count: 0 } as any, 'secret', cashier);
    expect(entitlements.resolve).toHaveBeenCalledWith(TENANT_A);
    expect(result.subscription).toEqual({ mode: 'grace', grace_until: graceUntil, plan_code: 'pro' });
  });
});
