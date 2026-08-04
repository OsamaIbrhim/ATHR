import { randomUUID } from 'crypto';
import { SuppliersRepository } from './suppliers.repository';
import { SuppliersService } from './suppliers.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `suppliers` module. */

const SUPPLIER_A = randomUUID();
const SUPPLIER_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    supplier: [
      {
        id: SUPPLIER_A,
        tenant_id: TENANT_A,
        name: 'Shared Name',
        company_name: 'A Trading',
        phone: '0100',
        alias_names: ['alias-a'],
      },
      {
        id: SUPPLIER_B,
        tenant_id: TENANT_B,
        name: 'Shared Name',
        company_name: 'B Trading',
        phone: '0200',
        alias_names: ['alias-b'],
      },
    ],
    purchaseInvoice: [],
  });
  const repository = new SuppliersRepository(prisma);
  return { prisma, repository, service: new SuppliersService(repository) };
}

describe('suppliers — cross-tenant isolation', () => {
  it('does not return another tenant\'s supplier by id', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_A), SUPPLIER_A)).not.toBeNull();
    expect(await repository.findById(contextFor(TENANT_B), SUPPLIER_A)).toBeNull();
  });

  it('lists only the calling tenant\'s suppliers', async () => {
    const { repository } = setup();
    expect((await repository.list(contextFor(TENANT_A))).map((row) => row.id)).toEqual([SUPPLIER_A]);
    expect((await repository.list(contextFor(TENANT_B))).map((row) => row.id)).toEqual([SUPPLIER_B]);
  });

  it('does not match another tenant\'s supplier on an identical name', async () => {
    const { repository } = setup();
    const hits = await repository.list(contextFor(TENANT_B), { search: 'Shared Name' });
    expect(hits.map((row) => row.id)).toEqual([SUPPLIER_B]);
  });

  /** The OCR alias resolver scans the whole supplier list — a classic leak point. */
  it('resolves aliases only within the calling tenant', async () => {
    const { service } = setup();
    expect(await service.resolveAlias(contextFor(TENANT_B), 'alias-a')).toBeNull();
    expect(await service.resolveAlias(contextFor(TENANT_B), 'alias-b')).not.toBeNull();
  });

  it('refuses to update or delete another tenant\'s supplier (§120)', async () => {
    const { repository, prisma } = setup();
    await expect(
      repository.update(contextFor(TENANT_B), SUPPLIER_A, { name: 'hijacked' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(repository.remove(contextFor(TENANT_B), SUPPLIER_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(prisma.supplier.rows).toHaveLength(2);
    expect(prisma.supplier.rows.find((row: any) => row.id === SUPPLIER_A).name).toBe('Shared Name');
  });

  it('stamps new suppliers with the calling tenant', async () => {
    const { repository } = setup();
    const created = await repository.save(contextFor(TENANT_B), { name: 'New B' } as any);
    expect(created.tenant_id).toBe(TENANT_B);
    expect(await repository.findById(contextFor(TENANT_A), created.id)).toBeNull();
  });
});
