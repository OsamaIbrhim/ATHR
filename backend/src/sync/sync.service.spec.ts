import { SyncService, PRODUCT_BATCH_SIZE } from './sync.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { TaxResolutionService } from '../tax/tax-resolution.service';
import { aTaxCode } from '../identity/testing/fixture-builders';

// WP-007 Phase A: pull() takes the resolved TenantContext first.
const ctx = contextFor(TENANT_A);

describe('SyncService incremental synchronization', () => {
  const variant = {
    id: 'variant-1',
    product_id: 'product-1',
    sku: 'SKU-1',
    cost_price: 100,
    barcode_ean13: '123',
    barcode_internal: 'B-1',
    size: 'M',
    color: 'Blue',
  };
  const product = {
    id: 'product-1',
    is_active: true,
    name_en: 'Shirt',
    name_ar: 'قميص',
    category_id: null,
    brand: null,
  };
  const quote = { net_price: 150, tax_amount: 21 };
  it('returns an unsigned protocol-v2 snapshot with a resumable cursor', async () => {
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([aTaxCode()]) },
      syncChange: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _max: { sequence: 42n } }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([variant]),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([product]),
      },
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([
          {
            branch_id: 'branch-1',
            variant_id: variant.id,
            qty_on_hand: 5,
          },
        ]),
      },
    };
    const pricing = {
      loadActiveRules: jest.fn().mockResolvedValue([]),
      quoteMany: jest
        .fn()
        .mockReturnValue(new Map([[variant.id, quote]])),
    };

    const result = await new SyncService(
      prisma as any,
      pricing as any,
      new TaxResolutionService(prisma as any),
    ).pull(ctx, 'branch-1');

    expect(result).toMatchObject({
      mode: 'snapshot',
      cursor: '42',
      reset_products: true,
      reset_stock: true,
    });
    expect(result.products[0]).toMatchObject({
      id: variant.id,
      catalog_version: 2,
      selling_price: 150,
      unit_tax: 21,
    });
    expect(result.products[0]).not.toHaveProperty('price_version');
    expect(result.products[0]).not.toHaveProperty('price_token');
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('captures the cursor before starting catalog reads', async () => {
    let releaseCursor!: (value: any) => void;
    const cursor = new Promise((resolve) => {
      releaseCursor = resolve;
    });
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([aTaxCode()]) },
      syncChange: { aggregate: jest.fn().mockReturnValue(cursor) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryStock: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const pricing = {
      loadActiveRules: jest.fn().mockResolvedValue([]),
      quoteMany: jest.fn().mockReturnValue(new Map()),
    };

    const pulling = new SyncService(
      prisma as any,
      pricing as any,
      new TaxResolutionService(prisma as any),
    ).pull(ctx, 'branch-1');

    await Promise.resolve();
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    expect(prisma.inventoryStock.findMany).not.toHaveBeenCalled();

    releaseCursor({ _max: { sequence: 7n } });
    const result = await pulling;
    expect(result.cursor).toBe('7');
    expect(prisma.productVariant.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns only changed variants and branch stock after a cursor', async () => {
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([aTaxCode()]) },
      syncChange: {
        findMany: jest.fn().mockResolvedValue([
          {
            sequence: 43n,
            kind: 'inventory',
            branch_id: 'branch-1',
            entity_key: variant.id,
          },
        ]),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([variant]),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([product]),
      },
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([
          {
            branch_id: 'branch-1',
            variant_id: variant.id,
            qty_on_hand: 4,
          },
        ]),
      },
    };
    const pricing = {
      loadActiveRules: jest.fn().mockResolvedValue([]),
      quoteMany: jest
        .fn()
        .mockReturnValue(new Map([[variant.id, quote]])),
    };

    const result = await new SyncService(
      prisma as any,
      pricing as any,
      new TaxResolutionService(prisma as any),
    ).pull(ctx, 'branch-1', '42');

    expect(result).toMatchObject({
      mode: 'delta',
      cursor: '43',
      reset_products: false,
      reset_stock: false,
    });
    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          is_active: true,
          id: { in: [variant.id] },
        }),
      }),
    );
  });

  it('returns an empty lightweight delta when nothing changed', async () => {
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([aTaxCode()]) },
      syncChange: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const result = await new SyncService(
      prisma as any,
      {} as any,
      new TaxResolutionService(prisma as any),
    ).pull(ctx, 'branch-1', '43');

    expect(result).toMatchObject({
      mode: 'delta',
      cursor: '43',
      products: [],
      stock: [],
      has_more: false,
    });
  });
});

describe('SyncService.attachProducts (chunked product batching)', () => {
  function makeVariantsAndProducts(count: number) {
    const variants = Array.from({ length: count }, (_, index) => ({
      id: `variant-${index}`,
      product_id: `product-${index}`,
      sku: `SKU-${index}`,
      cost_price: 100,
      barcode_ean13: null,
      barcode_internal: null,
      size: null,
      color: null,
    }));
    const products = variants.map((variant) => ({
      id: variant.product_id,
      is_active: true,
      name_en: `Product ${variant.product_id}`,
      name_ar: `منتج ${variant.product_id}`,
      category_id: null,
      brand: null,
    }));
    return { variants, products };
  }

  /** Mimics the real `product.findMany({ where: { id: { in: chunk } } } })` batch. */
  function chunkedProductFindMany(allProducts: { id: string }[]) {
    return jest.fn(({ where }: any) => {
      const ids: string[] = where.id.in;
      return Promise.resolve(allProducts.filter((product) => ids.includes(product.id)));
    });
  }

  function harness(prisma: any) {
    const pricing = {
      loadActiveRules: jest.fn().mockResolvedValue([]),
      quoteMany: jest.fn((variants: any[]) =>
        new Map(variants.map((variant) => [variant.id, { net_price: 150, tax_amount: 21 }])),
      ),
    };
    return new SyncService(prisma as any, pricing as any, new TaxResolutionService(prisma as any));
  }

  it('does not query product.findMany at all for zero variants', async () => {
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([]) },
      syncChange: { aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 1n } }) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn() },
      inventoryStock: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const result = await harness(prisma).pull(ctx, 'branch-1');

    expect(result.products).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('resolves every variant in exactly one chunk at exactly PRODUCT_BATCH_SIZE distinct products', async () => {
    const { variants, products } = makeVariantsAndProducts(PRODUCT_BATCH_SIZE);
    const productFindMany = chunkedProductFindMany(products);
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([]) },
      syncChange: { aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 1n } }) },
      productVariant: { findMany: jest.fn().mockResolvedValue(variants) },
      product: { findMany: productFindMany },
      inventoryStock: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const result = await harness(prisma).pull(ctx, 'branch-1');

    expect(result.products).toHaveLength(PRODUCT_BATCH_SIZE);
    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(productFindMany.mock.calls[0][0].where.id.in).toHaveLength(PRODUCT_BATCH_SIZE);
  });

  it('resolves every variant in two chunks at one product over PRODUCT_BATCH_SIZE', async () => {
    const count = PRODUCT_BATCH_SIZE + 1;
    const { variants, products } = makeVariantsAndProducts(count);
    const productFindMany = chunkedProductFindMany(products);
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([]) },
      syncChange: { aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 1n } }) },
      productVariant: { findMany: jest.fn().mockResolvedValue(variants) },
      product: { findMany: productFindMany },
      inventoryStock: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const result = await harness(prisma).pull(ctx, 'branch-1');

    expect(result.products).toHaveLength(count);
    expect(productFindMany).toHaveBeenCalledTimes(2);
    expect(productFindMany.mock.calls[0][0].where.id.in).toHaveLength(PRODUCT_BATCH_SIZE);
    expect(productFindMany.mock.calls[1][0].where.id.in).toHaveLength(1);
  });

  it('fails loud rather than silently dropping a variant whose product did not resolve', async () => {
    const { variants, products } = makeVariantsAndProducts(3);
    // Drop one product out of the batch result -- simulates the documented
    // race (or a genuine bug) where a variant's product_id does not resolve.
    const incompleteProducts = products.slice(0, 2);
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([]) },
      syncChange: { aggregate: jest.fn().mockResolvedValue({ _max: { sequence: 1n } }) },
      productVariant: { findMany: jest.fn().mockResolvedValue(variants) },
      product: { findMany: chunkedProductFindMany(incompleteProducts) },
      inventoryStock: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await expect(harness(prisma).pull(ctx, 'branch-1')).rejects.toThrow(
      /product .* not found for active variant/,
    );
  });
});
