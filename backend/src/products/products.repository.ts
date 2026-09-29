import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type Product, type ProductBarcode, type ProductVariant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';
import { STOCK_QUANTITY_COLUMNS } from '../inventory/inventory.repository';

export interface VariantListFilters {
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

type NewBarcode = Omit<Prisma.ProductBarcodeUncheckedCreateInput, 'tenant_id' | 'variant_id'>;
type NewVariant = Omit<Prisma.ProductVariantUncheckedCreateInput, 'tenant_id' | 'product_id' | 'id'>;

/** WP-007 Phase A §A.3.2 — tenant-scoped repository for the `products` module. */
@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The tenant predicate is applied to the *variant* and again to the nested
   * `product` relation filter. Scoping only the parent would still match a
   * variant whose product row belongs to another tenant — a real possibility
   * while `tenant_id` is nullable and no composite foreign key exists yet
   * (Phase B).
   */
  variantWhere(context: TenantScope, search?: string): Prisma.ProductVariantWhereInput {
    const query = search?.trim();
    const base: Prisma.ProductVariantWhereInput = {
      tenant_id: context.tenantId,
      is_active: true,
      product: { is_active: true, tenant_id: context.tenantId },
    };
    if (!query) return base;
    return {
      ...base,
      OR: [
        { sku: { contains: query, mode: 'insensitive' } },
        { barcodes: { some: { tenant_id: context.tenantId, code: query } } },
        { product: { name_en: { contains: query, mode: 'insensitive' } } },
        { product: { name_ar: { contains: query, mode: 'insensitive' } } },
      ],
    };
  }

  async findVariantById(context: TenantScope, id: string): Promise<ProductVariant | null> {
    return this.prisma.productVariant.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async listVariants(
    context: TenantScope,
    where: Prisma.ProductVariantWhereInput,
    page: number,
    pageSize: number,
  ): Promise<ProductVariant[]> {
    return this.prisma.productVariant.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async countVariants(
    _context: TenantScope,
    where: Prisma.ProductVariantWhereInput,
  ): Promise<number> {
    return this.prisma.productVariant.count({ where });
  }

  async searchVariants(context: TenantScope, q: string): Promise<ProductVariant[]> {
    return this.prisma.productVariant.findMany({
      where: {
        tenant_id: context.tenantId,
        is_active: true,
        OR: [
          { sku: { contains: q, mode: 'insensitive' } },
          { barcodes: { some: { tenant_id: context.tenantId, code: q } } },
          { product: { name_en: { contains: q, mode: 'insensitive' }, tenant_id: context.tenantId } },
        ],
      },
      take: 20,
    });
  }

  async findProductsByIds(context: TenantScope, ids: string[]): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { id: { in: ids }, tenant_id: context.tenantId },
    });
  }

  async findStockForVariants(context: TenantScope, variantIds: string[], branchId?: string) {
    const rows = await this.prisma.inventoryStock.findMany({
      where: {
        tenant_id: context.tenantId,
        variant_id: { in: variantIds },
        ...(branchId ? { warehouse: { branch_id: branchId } } : {}),
      },
      select: { ...STOCK_QUANTITY_COLUMNS, warehouse: { select: { branch_id: true } } },
    });
    // Consumers list stock per branch; the branch is the warehouse's owner.
    return rows.map(({ warehouse, ...stock }) => ({ ...stock, branch_id: warehouse.branch_id }));
  }

  async findBarcodes(context: TenantScope, variantIds: string[]): Promise<ProductBarcode[]> {
    return this.prisma.productBarcode.findMany({
      where: { tenant_id: context.tenantId, variant_id: { in: variantIds } },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Blueprint §120 "Raw SQL guarded": the trigram-similarity suggestion query
   * cannot go through Prisma's filter builder, so the tenant predicate is
   * bound explicitly as a parameter on both joined tables.
   */
  async similarNames(context: TenantScope, query: string) {
    return this.prisma.$queryRaw<
      Array<{ name_en: string; name_ar: string | null; sku: string; score: number }>
    >`
        SELECT p."name_en", p."name_ar", v."sku",
          GREATEST(
            similarity(COALESCE(p."name_en", ''), ${query}),
            similarity(COALESCE(p."name_ar", ''), ${query}),
            similarity(v."sku", ${query})
          ) AS score
        FROM "ProductVariant" v
        JOIN "Product" p ON p."id" = v."product_id"
        WHERE p."is_active" = true
          AND v."is_active" = true
          AND v."tenant_id" = ${context.tenantId}::uuid
          AND p."tenant_id" = ${context.tenantId}::uuid
        ORDER BY score DESC
        LIMIT 8
      `;
  }

  /** A product with its type, variants and their barcodes. */
  async findProduct(context: TenantScope, id: string) {
    return this.prisma.product.findFirst({
      where: { id, tenant_id: context.tenantId },
      include: {
        product_type: true,
        variants: { orderBy: { created_at: 'asc' }, include: { barcodes: true } },
      },
    });
  }

  async findVariantWithType(context: TenantScope, id: string) {
    return this.prisma.productVariant.findFirst({
      where: { id, tenant_id: context.tenantId },
      include: { product: { select: { product_type: { select: { attributes: true } } } } },
    });
  }

  async findBarcodeById(context: TenantScope, id: string): Promise<ProductBarcode | null> {
    return this.prisma.productBarcode.findFirst({ where: { id, tenant_id: context.tenantId } });
  }

  async tenantSettings(context: TenantScope): Promise<Prisma.JsonValue> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: context.tenantId },
      select: { settings: true },
    });
    return tenant?.settings ?? {};
  }

  /**
   * A product with all its variants and their barcodes: one transaction, four
   * statements however many variants. Ids are generated here so the barcodes
   * can name their variant without reading it back.
   */
  async createProduct(
    context: TenantScope,
    product: Omit<Prisma.ProductUncheckedCreateInput, 'tenant_id' | 'variants'>,
    variants: Array<NewVariant & { barcodes: NewBarcode[] }>,
  ) {
    const tenant_id = context.tenantId;
    return this.withBarcodeConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({ data: { ...product, tenant_id } });
        const rows = variants.map(({ barcodes, ...variant }) => ({
          variant: { ...variant, id: randomUUID(), tenant_id, product_id: created.id },
          barcodes,
        }));
        await tx.productVariant.createMany({ data: rows.map((row) => row.variant) });
        await tx.productBarcode.createMany({
          data: rows.flatMap((row) =>
            row.barcodes.map((barcode) => ({ ...barcode, tenant_id, variant_id: row.variant.id })),
          ),
        });
        return tx.product.findUniqueOrThrow({
          where: { id: created.id },
          include: { variants: { include: { barcodes: true } } },
        });
      }),
    );
  }

  async addVariant(
    context: TenantScope,
    productId: string,
    variant: NewVariant,
    barcodes: NewBarcode[],
  ) {
    const tenant_id = context.tenantId;
    const id = randomUUID();
    return this.withBarcodeConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.productVariant.create({ data: { ...variant, id, tenant_id, product_id: productId } });
        await tx.productBarcode.createMany({
          data: barcodes.map((barcode) => ({ ...barcode, tenant_id, variant_id: id })),
        });
        return tx.productVariant.findUniqueOrThrow({ where: { id }, include: { barcodes: true } });
      }),
    );
  }

  async updateProduct(
    context: TenantScope,
    id: string,
    data: Prisma.ProductUncheckedUpdateInput,
  ): Promise<Product> {
    const exists = await this.prisma.product.findFirst({ where: { id, tenant_id: context.tenantId } });
    if (!exists) throw new AthrDomainError('RESOURCE_NOT_FOUND', 'Product not found');
    return this.prisma.product.update({ where: { id }, data });
  }

  async updateVariant(
    context: TenantScope,
    id: string,
    data: Prisma.ProductVariantUncheckedUpdateInput,
  ): Promise<ProductVariant> {
    await this.assertVariantInTenant(context, id);
    return this.prisma.productVariant.update({ where: { id }, data });
  }

  async addBarcode(context: TenantScope, variantId: string, data: NewBarcode): Promise<ProductBarcode> {
    await this.assertVariantInTenant(context, variantId);
    return this.withBarcodeConflict(() =>
      this.prisma.productBarcode.create({
        data: { ...data, tenant_id: context.tenantId, variant_id: variantId },
      }),
    );
  }

  async updateBarcode(
    context: TenantScope,
    id: string,
    data: Prisma.ProductBarcodeUncheckedUpdateInput,
  ): Promise<ProductBarcode> {
    await this.assertBarcodeInTenant(context, id);
    return this.prisma.productBarcode.update({ where: { id }, data });
  }

  async removeBarcode(context: TenantScope, id: string): Promise<void> {
    await this.assertBarcodeInTenant(context, id);
    await this.prisma.productBarcode.delete({ where: { id } });
  }

  private async assertVariantInTenant(context: TenantScope, id: string): Promise<void> {
    if (!(await this.findVariantById(context, id))) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', 'Variant not found');
    }
  }

  private async assertBarcodeInTenant(context: TenantScope, id: string): Promise<void> {
    if (!(await this.findBarcodeById(context, id))) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', 'Barcode not found');
    }
  }

  /** The unique (tenant, code) index is the single arbiter of duplicate barcodes. */
  private async withBarcodeConflict<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        JSON.stringify(error.meta?.target ?? '').includes('code')
      ) {
        throw new AthrDomainError('CATALOG_BARCODE_CONFLICT', 'A barcode with this code already exists.');
      }
      throw error;
    }
  }

  /**
   * BR-TYP-103: a Variant with any transaction history cannot flip its
   * `item_type` by direct edit. Checked across every table that can
   * originate from a real transaction, not just the inventory ledger —
   * a service/non_stock Variant may have `SalesInvoiceItem` rows with no
   * `InventoryMovement` at all (BR-TYP-102).
   */
  async hasTransactionHistory(context: TenantScope, variantId: string): Promise<boolean> {
    const where = { tenant_id: context.tenantId, variant_id: variantId };
    const [
      movements,
      salesItems,
      purchaseItems,
      transferItems,
      returnItems,
      supplierReturnItems,
    ] = await Promise.all([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.salesInvoiceItem.count({ where }),
      this.prisma.purchaseInvoiceItem.count({ where }),
      this.prisma.transferItem.count({ where }),
      this.prisma.returnItem.count({ where }),
      this.prisma.supplierReturnItem.count({ where }),
    ]);
    return (
      movements + salesItems + purchaseItems + transferItems + returnItems + supplierReturnItems > 0
    );
  }
}
