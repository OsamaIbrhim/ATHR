import { randomUUID } from 'crypto';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `products` module. */

const PRODUCT_A = randomUUID();
const PRODUCT_B = randomUUID();
const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    product: [
      { id: PRODUCT_A, tenant_id: TENANT_A, name_en: 'Widget', is_active: true },
      { id: PRODUCT_B, tenant_id: TENANT_B, name_en: 'Widget', is_active: true },
    ],
    productVariant: [
      {
        id: VARIANT_A,
        tenant_id: TENANT_A,
        product_id: PRODUCT_A,
        sku: 'SKU-1',
        is_active: true,
        cost_price: 10,
        created_at: new Date(),
      },
      {
        id: VARIANT_B,
        tenant_id: TENANT_B,
        product_id: PRODUCT_B,
        sku: 'SKU-1',
        is_active: true,
        cost_price: 99,
        created_at: new Date(),
      },
    ],
    inventoryStock: [],
  }, {
    // Lets the nested `product: { tenant_id }` predicate actually be evaluated.
    productVariant: { product: { table: 'product', localKey: 'product_id' } },
  });
  const repository = new ProductsRepository(prisma);
  return { prisma, repository, service: new ProductsService(repository) };
}

describe('products — cross-tenant isolation', () => {
  it('does not return another tenant\'s variant by id', async () => {
    const { repository } = setup();
    expect(await repository.findVariantById(contextFor(TENANT_B), VARIANT_A)).toBeNull();
  });

  it('lists only the calling tenant\'s variants', async () => {
    const { service } = setup();
    const forA = await service.list(contextFor(TENANT_A), '', 1, 20);
    expect(forA.items.map((row: any) => row.id)).toEqual([VARIANT_A]);
    expect(forA.total).toBe(1);

    const forB = await service.list(contextFor(TENANT_B), '', 1, 20);
    expect(forB.items.map((row: any) => row.id)).toEqual([VARIANT_B]);
  });

  /** `ProductVariant.sku` is still globally unique until Phase B. */
  it('does not match another tenant\'s variant on an identical SKU', async () => {
    const { service } = setup();
    const hits = await service.search(contextFor(TENANT_B), 'SKU-1');
    expect(hits.map((row: any) => row.id)).toEqual([VARIANT_B]);
  });

  /**
   * Blueprint §125: the list-count cache was keyed on the search string
   * alone, so tenant A's total would have been served to tenant B.
   */
  it('does not serve one tenant\'s cached result count to another', async () => {
    const { service, prisma } = setup();
    prisma.productVariant.rows.push({
      id: randomUUID(),
      tenant_id: TENANT_A,
      product_id: PRODUCT_A,
      sku: 'SKU-2',
      is_active: true,
      cost_price: 10,
      created_at: new Date(),
    });

    const forA = await service.list(contextFor(TENANT_A), '', 1, 20);
    const forB = await service.list(contextFor(TENANT_B), '', 1, 20);

    expect(forA.total).toBe(2);
    expect(forB.total).toBe(1);
  });

  it('refuses to update another tenant\'s variant', async () => {
    const { service, prisma } = setup();
    await expect(
      service.updateVariant(contextFor(TENANT_B), VARIANT_A, { sku: 'hijacked' } as any),
    ).rejects.toThrow('Variant not found');
    expect(prisma.productVariant.rows.find((row: any) => row.id === VARIANT_A).sku).toBe('SKU-1');
  });

  it('refuses to archive another tenant\'s variant', async () => {
    const { service, prisma } = setup();
    await expect(service.removeVariant(contextFor(TENANT_B), VARIANT_A)).rejects.toThrow(
      'Variant not found',
    );
    expect(prisma.productVariant.rows.find((row: any) => row.id === VARIANT_A).is_active).toBe(true);
  });

  it('stamps a new product and its nested variant with the calling tenant', async () => {
    const { service, prisma } = setup();
    const created: any = await service.createProduct(contextFor(TENANT_B), {
      name_en: 'New',
      sku: 'SKU-NEW',
      cost_price: 5,
    } as any);

    expect(created.tenant_id).toBe(TENANT_B);
    expect(prisma.product.rows.at(-1).variants.create[0].tenant_id).toBe(TENANT_B);
  });
});
