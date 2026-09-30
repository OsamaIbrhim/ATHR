import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { unlimited } from '../entitlements/testing';

const ctx = contextFor(TENANT_A);

/** A service over a repository double: what is under test is the tracking rules, not Prisma. */
function setup(options: { variant?: Record<string, unknown>; features?: string[]; uomPrecision?: number | null } = {}) {
  const variant = { id: 'v1', item_type: 'stocked', tracking: 'none', base_uom_id: null, base_uom: null, product: null, ...options.variant };
  const repository = {
    findVariantWithType: jest.fn().mockResolvedValue(variant),
    updateVariant: jest.fn().mockImplementation(async (_c, _id, data) => ({ ...variant, ...data })),
    updateVariantTracking: jest.fn().mockImplementation(async (_c, _id, data) => ({ ...variant, ...data })),
    uomPrecision: jest.fn().mockResolvedValue(options.uomPrecision === undefined ? 0 : options.uomPrecision),
    hasTransactionHistory: jest.fn().mockResolvedValue(false),
  };
  const entitlements = {
    resolve: jest.fn().mockResolvedValue({ planCode: 'starter', features: new Set(options.features ?? []) }),
  };
  const service = new ProductsService(repository as any, {} as any, {} as any, unlimited, {} as any, entitlements as any);
  return { service, repository, entitlements };
}

describe('ProductsService tracking', () => {
  it('turning serial tracking on needs the tracking.serial plan feature', async () => {
    const denied = setup();
    await expect(denied.service.updateVariant(ctx, 'v1', { tracking: 'serial' })).rejects.toMatchObject({
      code: 'ENTITLEMENT_FEATURE_NOT_IN_PLAN',
    });
    expect(denied.repository.updateVariantTracking).not.toHaveBeenCalled();

    const allowed = setup({ features: ['tracking.serial'] });
    const updated = await allowed.service.updateVariant(ctx, 'v1', { tracking: 'serial' });
    expect(updated.tracking).toBe('serial');
    expect(allowed.repository.updateVariantTracking).toHaveBeenCalledWith(ctx, 'v1', expect.objectContaining({ tracking: 'serial' }));
  });

  it('batch needs its own feature: the serial one is not enough', async () => {
    const { service } = setup({ features: ['tracking.serial'] });
    await expect(service.updateVariant(ctx, 'v1', { tracking: 'batch' })).rejects.toMatchObject({
      code: 'ENTITLEMENT_FEATURE_NOT_IN_PLAN',
      overrides: { data: { feature: 'tracking.batch' } },
    });
  });

  it('turning tracking off needs no feature (a downgraded plan never traps a tenant)', async () => {
    const { service, repository, entitlements } = setup({ variant: { tracking: 'batch' } });
    await service.updateVariant(ctx, 'v1', { tracking: 'none' });
    expect(entitlements.resolve).not.toHaveBeenCalled();
    expect(repository.updateVariantTracking).toHaveBeenCalled();
  });

  it('an already tracked variant keeps working after a downgrade: edits that leave the mode alone need no feature', async () => {
    const { service, repository, entitlements } = setup({ variant: { tracking: 'serial' } });
    await service.updateVariant(ctx, 'v1', { sku: 'RENAMED' });
    await service.updateVariant(ctx, 'v1', { tracking: 'serial' });
    expect(entitlements.resolve).not.toHaveBeenCalled();
    // The mode did not change, so the stock-must-be-zero lock is not needed either.
    expect(repository.updateVariantTracking).not.toHaveBeenCalled();
    expect(repository.updateVariant).toHaveBeenCalledTimes(2);
  });

  it('an untracked variant edit costs no extra lookups', async () => {
    const { service, entitlements, repository } = setup();
    await service.updateVariant(ctx, 'v1', { sku: 'RENAMED' });
    expect(entitlements.resolve).not.toHaveBeenCalled();
    expect(repository.uomPrecision).not.toHaveBeenCalled();
  });

  describe('serial tracking needs a unit without decimals', () => {
    it('rejects the variant\'s current unit when it allows decimals', async () => {
      const { service } = setup({ features: ['tracking.serial'], variant: { base_uom_id: 'kg', base_uom: { precision: 3 } } });
      await expect(service.updateVariant(ctx, 'v1', { tracking: 'serial' })).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
    });

    it('checks the unit being set in the same update, and accepts a whole-unit one', async () => {
      const kg = setup({ features: ['tracking.serial'], uomPrecision: 3 });
      await expect(kg.service.updateVariant(ctx, 'v1', { tracking: 'serial', base_uom_id: 'kg' })).rejects.toMatchObject({
        code: 'REQUEST_FIELD_VALUE_INVALID',
      });
      const piece = setup({ features: ['tracking.serial'], uomPrecision: 0 });
      await expect(piece.service.updateVariant(ctx, 'v1', { tracking: 'serial', base_uom_id: 'pc' })).resolves.toBeDefined();
      const unknown = setup({ features: ['tracking.serial'], uomPrecision: null });
      await expect(unknown.service.updateVariant(ctx, 'v1', { tracking: 'serial', base_uom_id: 'nope' })).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    });

    it('does not let a serial variant move to a fractional unit later', async () => {
      const { service } = setup({ variant: { tracking: 'serial' }, uomPrecision: 3 });
      await expect(service.updateVariant(ctx, 'v1', { base_uom_id: 'kg' })).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
    });

    it('batch tracking works with any unit', async () => {
      const { service } = setup({ features: ['tracking.batch'], variant: { base_uom_id: 'kg', base_uom: { precision: 3 } } });
      await expect(service.updateVariant(ctx, 'v1', { tracking: 'batch' })).resolves.toBeDefined();
    });
  });

  it('only stocked items can be tracked', async () => {
    const { service } = setup({ features: ['tracking.batch'], variant: { item_type: 'service' } });
    await expect(service.updateVariant(ctx, 'v1', { tracking: 'batch' })).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
    const stocked = setup({ features: ['tracking.batch'], variant: { tracking: 'batch' } });
    await expect(stocked.service.updateVariant(ctx, 'v1', { item_type: 'service' })).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
  });
});

describe('ProductsRepository.updateVariantTracking', () => {
  function repositoryOver(options: { stock?: number[]; onTheRoad?: boolean }) {
    const statements: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?').replace(/\s+/g, ' ');
        statements.push(sql);
        if (sql.includes('FROM "InventoryStock"')) return (options.stock ?? []).map((qty) => ({ qty_on_hand: new Prisma.Decimal(qty) }));
        return options.onTheRoad ? [{ found: 1 }] : [];
      }),
      productVariant: { update: jest.fn().mockResolvedValue({ id: 'v1', tracking: 'batch' }) },
    };
    const prisma = {
      productVariant: { findFirst: jest.fn().mockResolvedValue({ id: 'v1' }) },
      $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    };
    return { repository: new ProductsRepository(prisma as any), tx, statements };
  }

  it('changes tracking only while every warehouse holds zero, locking the stock rows first', async () => {
    const { repository, tx, statements } = repositoryOver({ stock: [0, 0] });
    await repository.updateVariantTracking(ctx, 'v1', { tracking: 'batch' });
    expect(statements[0]).toContain('FOR UPDATE');
    expect(tx.productVariant.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { tracking: 'batch' } });
  });

  it('works for a variant that never had a stock row', async () => {
    const { repository } = repositoryOver({ stock: [] });
    await expect(repository.updateVariantTracking(ctx, 'v1', { tracking: 'serial' })).resolves.toBeDefined();
  });

  it.each([
    ['stock on hand', { stock: [0, 3] }],
    ['negative stock', { stock: [-1] }],
    ['a transfer still in transit', { stock: [0], onTheRoad: true }],
  ])('refuses with %s', async (_label, options) => {
    const { repository, tx } = repositoryOver(options);
    await expect(repository.updateVariantTracking(ctx, 'v1', { tracking: 'batch' })).rejects.toBeInstanceOf(ConflictException);
    await expect(repository.updateVariantTracking(ctx, 'v1', { tracking: 'batch' })).rejects.toMatchObject({
      response: { code: 'CATALOG_TRACKING_CHANGE_RESTRICTED' },
    });
    expect(tx.productVariant.update).not.toHaveBeenCalled();
  });
});
