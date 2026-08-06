import { Injectable } from '@nestjs/common';
import { Prisma, type Product, type ProductVariant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantScope } from '../identity/tenant-context.type';

export interface VariantListFilters {
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

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
        { barcode_ean13: query },
        { barcode_internal: query },
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
          { barcode_ean13: q },
          { barcode_internal: q },
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
    return this.prisma.inventoryStock.findMany({
      where: {
        tenant_id: context.tenantId,
        variant_id: { in: variantIds },
        ...(branchId ? { branch_id: branchId } : {}),
      },
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

  async saveProduct(
    context: TenantScope,
    data: Omit<Prisma.ProductUncheckedCreateInput, 'tenant_id'>,
  ): Promise<Product> {
    return this.prisma.product.create({
      data: { ...data, tenant_id: context.tenantId },
      include: { variants: true },
    });
  }

  async updateVariant(
    context: TenantScope,
    id: string,
    data: Prisma.ProductVariantUncheckedUpdateInput,
  ): Promise<ProductVariant> {
    await this.assertVariantInTenant(context, id);
    return this.prisma.productVariant.update({ where: { id }, data });
  }

  private async assertVariantInTenant(context: TenantScope, id: string): Promise<void> {
    if (!(await this.findVariantById(context, id))) {
      throw new AthrDomainError('RESOURCE_NOT_FOUND', 'Variant not found');
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
