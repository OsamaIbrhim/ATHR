import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { AssortmentRepository } from './assortment.repository';
import { AssortmentService } from './assortment.service';
import { BranchesRepository } from '../branches/branches.repository';
import { ProductsRepository } from '../products/products.repository';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aBranch, aProduct, aProductVariant } from '../identity/testing/fixture-builders';

/** WP-008 Phase A — cross-tenant isolation for the `assortment` module. */

const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();
const ROW_A = randomUUID();

function setup() {
  const prisma = fakePrisma({
    branch: [
      aBranch({ id: BRANCH_A, tenant_id: TENANT_A, code: 'MAIN', name_ar: 'A' }),
      aBranch({ id: BRANCH_B, tenant_id: TENANT_B, code: 'MAIN-B', name_ar: 'B' }),
    ],
    product: [
      aProduct({ tenant_id: TENANT_A, name_en: 'Widget' }),
    ],
    productVariant: [
      aProductVariant({ id: VARIANT_A, tenant_id: TENANT_A, sku: 'SKU-A', cost_price: new Prisma.Decimal(10) }),
      aProductVariant({ id: VARIANT_B, tenant_id: TENANT_B, sku: 'SKU-B', cost_price: new Prisma.Decimal(10) }),
    ],
    assortment: [
      {
        id: ROW_A,
        tenant_id: TENANT_A,
        branch_id: BRANCH_A,
        variant_id: VARIANT_A,
        is_sellable: true,
        is_purchasable: true,
        is_displayable: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
  });
  const assortmentRepository = new AssortmentRepository(prisma);
  const branchesRepository = new BranchesRepository(prisma);
  const productsRepository = new ProductsRepository(prisma);
  const service = new AssortmentService(assortmentRepository, branchesRepository, productsRepository);
  return { prisma, repository: assortmentRepository, service };
}

describe('assortment — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s assortment rows', async () => {
    const { service } = setup();
    expect((await service.list(contextFor(TENANT_A), {})).map((row) => row.id)).toEqual([ROW_A]);
    expect(await service.list(contextFor(TENANT_B), {})).toEqual([]);
  });

  it('does not resolve another tenant\'s assortment row by id', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_B), ROW_A)).toBeNull();
  });

  it('rejects upserting against another tenant\'s branch', async () => {
    const { service } = setup();
    await expect(
      service.upsert(contextFor(TENANT_B), { branch_id: BRANCH_A, variant_id: VARIANT_B, is_sellable: false }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('rejects upserting against another tenant\'s variant', async () => {
    const { service } = setup();
    await expect(
      service.upsert(contextFor(TENANT_B), { branch_id: BRANCH_B, variant_id: VARIANT_A, is_sellable: false }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('stamps a new assortment row with the calling tenant and does not leak across tenants', async () => {
    const { service, prisma } = setup();
    const created = await service.upsert(contextFor(TENANT_B), {
      branch_id: BRANCH_B,
      variant_id: VARIANT_B,
      is_sellable: false,
    });
    expect((created as any).tenant_id).toBe(TENANT_B);
    expect(await (new AssortmentRepository(prisma)).findById(contextFor(TENANT_A), created.id)).toBeNull();
  });

  /** BR-AST-100: distinct from `Product.is_active` -- toggling this flag must not touch the variant row at all. */
  it('toggling sellability does not mutate the underlying variant\'s is_active flag', async () => {
    const { service, prisma } = setup();
    await service.upsert(contextFor(TENANT_A), { branch_id: BRANCH_A, variant_id: VARIANT_A, is_sellable: false });
    const variant = prisma.productVariant.rows.find((row: any) => row.id === VARIANT_A);
    expect(variant.is_active).toBe(true);
  });
});
