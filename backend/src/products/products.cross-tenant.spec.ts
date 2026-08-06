import { randomUUID } from 'crypto';
import { ProductsRepository } from './products.repository';
import { ProductsService } from './products.service';
import { BrandsRepository } from '../brands/brands.repository';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-007 Phase A §A.3.6 / WP-008 Phase A — cross-tenant isolation for the `products` module. */

const PRODUCT_A = randomUUID();
const PRODUCT_B = randomUUID();
const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();
const BRAND_A = randomUUID();
const BRAND_B = randomUUID();

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
        item_type: 'stocked',
        created_at: new Date(),
      },
      {
        id: VARIANT_B,
        tenant_id: TENANT_B,
        product_id: PRODUCT_B,
        sku: 'SKU-1',
        is_active: true,
        cost_price: 99,
        item_type: 'stocked',
        created_at: new Date(),
      },
    ],
    inventoryStock: [],
    inventoryMovement: [],
    salesInvoiceItem: [],
    purchaseInvoiceItem: [],
    transferItem: [],
    returnItem: [],
    supplierReturnItem: [],
    brand: [
      { id: BRAND_A, tenant_id: TENANT_A, name: 'Nike', is_active: true },
      { id: BRAND_B, tenant_id: TENANT_B, name: 'Puma', is_active: true },
    ],
  }, {
    // Lets the nested `product: { tenant_id }` predicate actually be evaluated.
    productVariant: { product: { table: 'product', localKey: 'product_id' } },
  });
  const repository = new ProductsRepository(prisma);
  const brands = new BrandsRepository(prisma);
  return { prisma, repository, brands, service: new ProductsService(repository, brands) };
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

  it('stamps a new product with the calling tenant', async () => {
    const { service } = setup();
    const created: any = await service.createProduct(contextFor(TENANT_B), {
      name_en: 'New',
      sku: 'SKU-NEW',
      cost_price: 5,
    } as any);

    expect(created.tenant_id).toBe(TENANT_B);
    // WP-007 Phase B: ProductVariant's composite FK to Product now covers
    // tenant_id, so the nested variant create no longer stamps it explicitly
    // — Prisma derives it from the parent, and the DB-level composite FK
    // (proven in the constraint-rejection suite) is what actually guarantees
    // it can never diverge from the parent's tenant.
  });

  /** WP-008 Phase A (BR-CLS-103/BR-PROD-100): brand_id must resolve within the caller's own tenant. */
  it('rejects a cross-tenant brand_id on product creation', async () => {
    const { service } = setup();
    await expect(
      service.createProduct(contextFor(TENANT_B), {
        name_en: 'New',
        sku: 'SKU-NEW-2',
        cost_price: 5,
        brand_id: BRAND_A,
      } as any),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('accepts a same-tenant brand_id on product creation', async () => {
    const { service } = setup();
    const created: any = await service.createProduct(contextFor(TENANT_A), {
      name_en: 'New',
      sku: 'SKU-NEW-3',
      cost_price: 5,
      brand_id: BRAND_A,
    } as any);
    expect(created.brand_id).toBe(BRAND_A);
  });
});

/** WP-008 Phase A (BR-TYP-103): item_type change restriction once transaction history exists. */
describe('products — item_type change restriction', () => {
  it('allows an item_type change on a variant with no transaction history', async () => {
    const { service } = setup();
    const updated = await service.updateVariant(contextFor(TENANT_A), VARIANT_A, {
      item_type: 'non_stock',
    } as any);
    expect(updated.item_type).toBe('non_stock');
  });

  it('rejects an item_type change once the variant has inventory movement history', async () => {
    const { service, prisma } = setup();
    prisma.inventoryMovement.rows.push({
      id: randomUUID(),
      tenant_id: TENANT_A,
      variant_id: VARIANT_A,
      branch_id: randomUUID(),
      movement_type: 'sale',
    });

    await expect(
      service.updateVariant(contextFor(TENANT_A), VARIANT_A, { item_type: 'service' } as any),
    ).rejects.toMatchObject({ code: 'CATALOG_ITEM_TYPE_CHANGE_RESTRICTED' });
  });

  it('rejects an item_type change once the variant has sales history even with no inventory movement', async () => {
    const { service, prisma } = setup();
    prisma.salesInvoiceItem.rows.push({
      id: randomUUID(),
      tenant_id: TENANT_A,
      variant_id: VARIANT_A,
      sales_invoice_id: randomUUID(),
    });

    await expect(
      service.updateVariant(contextFor(TENANT_A), VARIANT_A, { item_type: 'service' } as any),
    ).rejects.toMatchObject({ code: 'CATALOG_ITEM_TYPE_CHANGE_RESTRICTED' });
  });

  it('does not block an update that leaves item_type unchanged, even with transaction history', async () => {
    const { service, prisma } = setup();
    prisma.inventoryMovement.rows.push({
      id: randomUUID(),
      tenant_id: TENANT_A,
      variant_id: VARIANT_A,
      branch_id: randomUUID(),
      movement_type: 'sale',
    });

    const updated = await service.updateVariant(contextFor(TENANT_A), VARIANT_A, {
      item_type: 'stocked',
      sku: 'SKU-1-RENAMED',
    } as any);
    expect(updated.sku).toBe('SKU-1-RENAMED');
  });
});
