import { randomUUID } from 'crypto';
import { BrandsRepository } from './brands.repository';
import { BrandsService } from './brands.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase A — cross-tenant isolation for the `brands` module. */

const BRAND_A = randomUUID();
const BRAND_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    brand: [
      { id: BRAND_A, tenant_id: TENANT_A, name: 'Nike', is_active: true },
      { id: BRAND_B, tenant_id: TENANT_B, name: 'Puma', is_active: true },
    ],
    product: [],
  });
  const repository = new BrandsRepository(prisma);
  return { prisma, repository, service: new BrandsService(repository) };
}

describe('brands — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s brands', async () => {
    const { service } = setup();
    expect((await service.findAll(contextFor(TENANT_A))).map((row) => row.id)).toEqual([BRAND_A]);
    expect((await service.findAll(contextFor(TENANT_B))).map((row) => row.id)).toEqual([BRAND_B]);
  });

  it('does not resolve another tenant\'s brand by id', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_B), BRAND_A)).toBeNull();
  });

  it('rejects a cross-tenant brand reference', async () => {
    const { repository } = setup();
    await expect(repository.assertInTenant(contextFor(TENANT_B), BRAND_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('refuses to update another tenant\'s brand', async () => {
    const { service } = setup();
    await expect(
      service.update(contextFor(TENANT_B), BRAND_A, { name: 'Hijacked' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('stamps a new brand with the calling tenant', async () => {
    const { repository } = setup();
    const created = await repository.save(contextFor(TENANT_B), { name: 'New Brand' } as any);
    expect(created.tenant_id).toBe(TENANT_B);
    expect(await repository.findById(contextFor(TENANT_A), created.id)).toBeNull();
  });

  /**
   * Same name is allowed in two different tenants (BR-CLS-103's uniqueness is
   * per-tenant, not global) -- this is what the `findByName` conflict check
   * in `BrandsService.create` must respect.
   */
  it('rejects a same-tenant duplicate name but allows the identical name in another tenant', async () => {
    const { service } = setup();
    await expect(service.create(contextFor(TENANT_A), { name: 'Nike' })).rejects.toMatchObject({
      code: 'CATALOG_BRAND_NAME_CONFLICT',
    });
    const created = await service.create(contextFor(TENANT_B), { name: 'Nike' });
    expect((created as any).tenant_id).toBe(TENANT_B);
  });
});
