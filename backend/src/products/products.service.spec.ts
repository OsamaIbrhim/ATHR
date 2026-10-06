import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { BrandsRepository } from '../brands/brands.repository';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { TaxCodeService } from '../tax/tax-code.service';
import { TaxCodeRepository } from '../tax/tax-code.repository';
import { aTaxCategory, aTaxCode } from '../identity/testing/fixture-builders';
import { fullAccess, unlimited } from '../entitlements/testing';
import { ProductTypesService } from '../catalog/product-types.service';

// WP-007 Phase A: `ProductsService` now depends on `ProductsRepository`
// rather than `PrismaService` directly, and every method takes a
// `TenantContext`. These tests keep their original intent and assertions;
// they build the repository over the same prisma mocks and additionally
// assert the tenant predicate is present on the queries.
const ctx = contextFor(TENANT_A);

function serviceOver(prisma: any) {
  return new ProductsService(new ProductsRepository(prisma as any), new BrandsRepository(prisma as any), new TaxCodeService(new TaxCodeRepository(prisma as any)), unlimited, new ProductTypesService(prisma as any), fullAccess);
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
        { warehouse: { branch_id: 'b1' }, variant_id: 'v1', qty_on_hand: 7, qty_reserved: 0 },
      ]),
    },
    productBarcode: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('ProductsService pagination', () => {
  function createPrisma(extra: Record<string, unknown> = {}) {
    const tx = {
      product: {
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'p1', variants: [] }),
      },
      productVariant: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      productBarcode: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    // WP-008 Phase C (BR-TAX-201): a Product must resolve to a tax category,
    // and with none supplied the service falls back to the tenant's STANDARD
    // one — the row migration 202608130003 creates for every tenant.
    const prisma = {
      $transaction: (fn: any) => fn(tx),
      taxCategory: {
        findMany: jest.fn().mockResolvedValue([aTaxCategory()]),
        count: jest.fn().mockResolvedValue(1),
      },
      ...extra,
    };
    return { prisma, tx };
  }

  const clothingType = {
    id: 'type-1',
    is_active: true,
    attributes: [
      { key: 'size', label_ar: 'المقاس', label_en: 'Size', kind: 'select', options: ['M', 'L'], axis: true },
      { key: 'color', label_ar: 'اللون', label_en: 'Color', kind: 'text', axis: true },
    ],
  };

  it('creates a simple product with one variant and preserves an explicit zero cost', async () => {
    const { prisma, tx } = createPrisma();
    await serviceOver(prisma).createProduct(ctx, {
      name_en: 'Free sample',
      variants: [{ sku: 'SAMPLE-0', cost_price: 0 }],
    } as any);

    expect(tx.productVariant.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ sku: 'SAMPLE-0', cost_price: 0, label: '', attributes: {}, tenant_id: ctx.tenantId })],
    });
  });

  it('creates every variant of a typed product with its computed label and barcodes in one go', async () => {
    const { prisma, tx } = createPrisma({ productType: { findFirst: jest.fn().mockResolvedValue(clothingType) } });
    await serviceOver(prisma).createProduct(ctx, {
      name_en: 'Shirt',
      product_type_id: 'type-1',
      variants: [
        { sku: 'S-M-BLK', cost_price: 10, attributes: { size: 'M', color: 'Black' }, barcodes: [{ code: '111', pack_qty: 6 }] },
        { sku: 'S-L-BLK', cost_price: 10, attributes: { size: 'L', color: 'Black' } },
      ],
    } as any);

    const rows = tx.productVariant.createMany.mock.calls[0][0].data;
    expect(rows.map((row: any) => row.label)).toEqual(['M · Black', 'L · Black']);
    expect(tx.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ product_type_id: 'type-1', has_variants: true }),
    });
    expect(tx.productBarcode.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ code: '111', pack_qty: 6, kind: 'standard', variant_id: rows[0].id })],
    });
  });

  it('rejects attributes the product type does not allow, duplicates and multi-variant simple products', async () => {
    const { prisma } = createPrisma({ productType: { findFirst: jest.fn().mockResolvedValue(clothingType) } });
    const service = serviceOver(prisma);
    const typed = (variants: any[]) =>
      service.createProduct(ctx, { name_en: 'Shirt', product_type_id: 'type-1', variants } as any);

    await expect(typed([{ sku: 'A', cost_price: 1, attributes: { size: 'XXL', color: 'Red' } }])).rejects.toThrow(/size/);
    await expect(typed([{ sku: 'A', cost_price: 1, attributes: { size: 'M', color: 'Red', brand: 'x' } }])).rejects.toThrow(/brand/);
    await expect(typed([
      { sku: 'A', cost_price: 1, attributes: { size: 'M', color: 'Red' } },
      { sku: 'B', cost_price: 1, attributes: { size: 'M', color: 'Red' } },
    ])).rejects.toThrow(/same attribute combination/);
    await expect(
      service.createProduct(ctx, {
        name_en: 'Two',
        variants: [{ sku: 'A', cost_price: 1 }, { sku: 'B', cost_price: 1 }],
      } as any),
    ).rejects.toThrow(/exactly one variant/);
  });

  it('shows how each variant is tracked in the list and the search', async () => {
    const variants = [
      { id: 'v1', product_id: 'p1', cost_price: 100, tracking: 'serial' },
      { id: 'v2', product_id: 'p1', cost_price: 100, tracking: 'none' },
    ];
    const service = serviceOver(productReadPrisma(variants));
    const page = await service.list(ctx, '', 1, 20);
    expect(page.items.map((item: any) => [item.id, item.tracking])).toEqual([['v1', 'serial'], ['v2', 'none']]);
    const found = await service.search(ctx, 'x');
    expect(found.map((item: any) => item.tracking)).toEqual(['serial', 'none']);
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
      taxCode: { findMany: jest.fn().mockResolvedValue([aTaxCode()]) },
      ...productReadPrisma([], 0),
      $queryRaw: jest.fn().mockResolvedValue([
        { name_en: 'T-Shirt', name_ar: 'تي شيرت', sku: 'TSHIRT-1', score: 0.72 },
      ]),
    };
    const result = await serviceOver(prisma).list(ctx, 'T-Shert', 1, 20);
    expect(result.suggestions).toEqual([{ value: 'T-Shirt', label: 'تي شيرت' }]);
  });


  it('does not expose moving-average cost as an editable variant field', async () => {
    const prisma = {
      taxCode: { findMany: jest.fn().mockResolvedValue([aTaxCode()]) },
      productVariant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'v1', tracking: 'none' }),
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
      taxCode: { findMany: jest.fn().mockResolvedValue([aTaxCode()]) },
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
