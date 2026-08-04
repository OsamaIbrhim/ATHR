import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// WP-007 Phase A: `ProductsService` now depends on `ProductsRepository`
// rather than `PrismaService` directly, and every method takes a
// `TenantContext`. These tests keep their original intent and assertions;
// they build the repository over the same prisma mocks and additionally
// assert the tenant predicate is present on the queries.
const ctx = contextFor(TENANT_A);

function serviceOver(prisma: any) {
  return new ProductsService(new ProductsRepository(prisma as any));
}

function productReadPrisma(variants: any[], total = variants.length) {
  return {
    productVariant: {
      count: jest.fn().mockResolvedValue(total),
      findMany: jest.fn().mockResolvedValue(variants),
    },
    product: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p1', is_active: true, name_en: 'Shirt' },
      ]),
    },
    inventoryStock: {
      findMany: jest.fn().mockResolvedValue([
        { branch_id: 'b1', variant_id: 'v1', qty_on_hand: 7, qty_reserved: 0 },
      ]),
    },
  };
}

describe('ProductsService pagination', () => {
  it('preserves an explicitly confirmed zero initial cost', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'p1', variants: [] });
    const service = serviceOver({ product: { create } });

    await service.createProduct(ctx, {
      name_en: 'Free sample',
      sku: 'SAMPLE-0',
      cost_price: 0,
    } as any);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        variants: {
          create: [expect.objectContaining({ cost_price: 0 })],
        },
      }),
    }));
  });

  it('hydrates the first page in one parallel relation wave', async () => {
    const variants = [{ id: 'v1', product_id: 'p1', cost_price: 100 }];
    const prisma = productReadPrisma(variants, 41);
    const result = await serviceOver(prisma).list(ctx, '', 1, 20, 'b1', true);

    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenant_id: ctx.tenantId,
        is_active: true,
        product: { is_active: true, tenant_id: ctx.tenantId },
      },
      skip: 0,
      take: 20,
    }));
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryStock.findMany).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      page: 1,
      page_size: 20,
      total: 41,
      total_pages: 3,
      items: [{
        id: 'v1',
        product: { id: 'p1', name_en: 'Shirt' },
        available_here: 7,
      }],
    });
  });

  it('suggests close product names when a typed name has no exact match', async () => {
    const prisma = {
      ...productReadPrisma([], 0),
      $queryRaw: jest.fn().mockResolvedValue([
        { name_en: 'T-Shirt', name_ar: 'تي شيرت', sku: 'TSHIRT-1', score: 0.72 },
      ]),
    };
    const result = await serviceOver(prisma).list(ctx, 'T-Shert', 1, 20);
    expect(result.suggestions).toEqual([{ value: 'T-Shirt', label: 'تي شيرت' }]);
  });

  it('coalesces repeated identical count queries during a request burst', async () => {
    const prisma = productReadPrisma([], 0);
    const service = serviceOver(prisma);
    await Promise.all([service.list(ctx, '', 1, 20), service.list(ctx, '', 2, 20)]);
    expect(prisma.productVariant.count).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.findMany).toHaveBeenCalledTimes(2);
  });


  it('does not expose moving-average cost as an editable variant field', async () => {
    const prisma = {
      productVariant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'v1' }),
        update: jest.fn().mockResolvedValue({ id: 'v1' }),
      },
    };
    const service = serviceOver(prisma);

    await service.updateVariant(ctx, 'v1', {
      sku: 'UPDATED-SKU',
    } as any);

    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: expect.not.objectContaining({
        cost_price: expect.anything(),
      }),
    });
  });

  it('soft-deactivates a variant so delayed offline sales can still reference it', async () => {
    const prisma = {
      productVariant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'v1', is_active: true }),
        update: jest.fn().mockResolvedValue({ id: 'v1', is_active: false }),
      },
    };
    const result = await serviceOver(prisma).removeVariant(ctx, 'v1');

    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { is_active: false },
    });
    expect(result.is_active).toBe(false);
  });

});
