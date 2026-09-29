import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto, UpdateVariantDto } from './dto/product.dto';
import { ProductsRepository } from './products.repository';
import { BrandsRepository } from '../brands/brands.repository';
import { TaxCodeService } from '../tax/tax-code.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import { LimitService } from '../entitlements/limit.service';
import { quantityNumber } from '../common/quantity';

@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly brands: BrandsRepository,
    private readonly tax: TaxCodeService,
    private readonly limits: LimitService,
  ) {}

  /**
   * WP-008 Phase C (BR-TAX-201). Explicit id wins; otherwise the tenant's
   * `STANDARD` category, which the `202608130003` migration created for every
   * tenant that owned products. Never invents one — a tenant with no category
   * at all is a real misconfiguration and is reported as such.
   */
  private async resolveTaxCategoryId(
    context: TenantContext,
    requested: string | undefined,
  ): Promise<string> {
    if (requested) {
      const category = await this.tax.findCategoryInTenant(context, requested);
      if (!category) {
        throw new AthrDomainError(
          'RESOURCE_NOT_FOUND',
          `Tax category ${requested} not found.`,
        );
      }
      return category.id;
    }
    const fallback = await this.tax.findDefaultCategory(context);
    if (!fallback) {
      throw new AthrDomainError(
        'TAX_NO_ACTIVE_CODE',
        'This tenant has no tax category, so a product cannot be created (BR-TAX-201). Create a tax category first.',
      );
    }
    return fallback.id;
  }

  async list(
    context: TenantContext,
    q: string,
    page: number,
    pageSize: number,
    branchId?: string,
    includeCost = false,
  ) {
    const query = q.trim();
    const where = this.repository.variantWhere(context, query);

    // Keep list and count independent, then hydrate both relations in one
    // additional parallel database wave. Prisma's nested include strategy used
    // sequential relation queries and paid the remote DB round-trip repeatedly.
    const [total, baseVariants] = await Promise.all([
      this.repository.countVariants(context, where),
      this.repository.listVariants(context, where, page, pageSize),
    ]);
    const variants = await this.hydrateVariants(context, baseVariants, branchId);
    const items = variants.map((variant) => this.present(variant, branchId, includeCost));

    let suggestions: { value: string; label: string }[] = [];
    if (query.length >= 2 && total === 0) {
      const similar = await this.repository.similarNames(context, query);
      const seen = new Set<string>();
      suggestions = similar
        .filter((item) => item.score >= 0.15)
        .map((item) => ({ value: item.name_en || item.sku, label: item.name_ar || item.name_en || item.sku }))
        .filter((item) => !seen.has(item.value) && !!seen.add(item.value))
        .slice(0, 3);
    }

    return {
      items,
      page,
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      suggestions,
    };
  }

  private async hydrateVariants(context: TenantContext, variants: any[], branchId?: string) {
    if (!variants.length) return [];

    const variantIds = variants.map((variant) => variant.id);
    const productIds = [...new Set(variants.map((variant) => variant.product_id))];
    const [products, inventory] = await Promise.all([
      this.repository.findProductsByIds(context, productIds),
      this.repository.findStockForVariants(context, variantIds, branchId),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const inventoryByVariant = new Map<string, any[]>();
    for (const row of inventory) {
      const rows = inventoryByVariant.get(row.variant_id) || [];
      rows.push(row);
      inventoryByVariant.set(row.variant_id, rows);
    }

    return variants.map((variant) => ({
      ...variant,
      product: productById.get(variant.product_id),
      inventory: inventoryByVariant.get(variant.id) || [],
    }));
  }

  async search(context: TenantContext, q: string, branchId?: string, includeCost = false) {
    const baseVariants = await this.repository.searchVariants(context, q);
    const variants = await this.hydrateVariants(context, baseVariants, branchId);
    return variants.map((variant) => this.present(variant, branchId, includeCost));
  }

  private present(variant: any, branchId?: string, includeCost = false) {
    const result = {
      ...variant,
      stock_by_branch: variant.inventory,
      available_here: branchId
        ? quantityNumber(variant.inventory.find((item: any) => item.branch_id === branchId)?.qty_on_hand ?? 0)
        : undefined,
    };
    if (includeCost) return result;
    const { cost_price: _costPrice, ...safe } = result;
    return safe;
  }

  async createProduct(context: TenantContext, dto: CreateProductDto) {
    await this.limits.assertCanCreate(context.tenantId, 'products');
    // BR-CLS-103 / BR-PROD-100: a cross-tenant brand_id must never be
    // accepted -- fail loudly here rather than relying solely on the
    // composite FK to reject it at the DB layer.
    if (dto.brand_id) {
      await this.brands.assertInTenant(context, dto.brand_id);
    }
    // WP-008 Phase C (BR-TAX-201): every Product resolves to a tax category.
    // An explicit `tax_category_id` is validated in-tenant first, so a
    // cross-tenant id reads as "not found" rather than reaching the composite
    // FK. Omitted, it falls back to the tenant's STANDARD category — the one
    // the Phase C migration created for every existing tenant. If neither
    // exists the create is rejected: a product with no tax category would be
    // unsellable anyway, and failing at creation names the cause.
    const taxCategoryId = await this.resolveTaxCategoryId(context, dto.tax_category_id);
    const product = await this.repository.saveProduct(context, {
      name_en: dto.name_en,
      name_ar: dto.name_ar,
      brand: dto.brand,
      brand_id: dto.brand_id,
      category_id: dto.category_id,
      tax_category_id: taxCategoryId,
      has_variants: !!(dto.size || dto.color || dto.style),
      variants: {
        create: [{
          sku: dto.sku,
          barcode_ean13: dto.barcode_ean13 || null,
          barcode_internal: dto.barcode_internal || dto.sku,
          size: dto.size || null,
          color: dto.color || null,
          style: dto.style || null,
          cost_price: dto.cost_price,
          item_type: dto.item_type,
          base_uom_id: dto.base_uom_id,
        }],
      },
    });
    return product;
  }

  async updateVariant(context: TenantContext, id: string, dto: UpdateVariantDto) {
    const exists = await this.repository.findVariantById(context, id);
    if (!exists) throw new NotFoundException('Variant not found');

    // BR-TYP-103: a Variant with transaction history cannot flip item_type
    // by direct edit — a new Variant or a documented migration path is
    // needed instead.
    if (dto.item_type !== undefined && dto.item_type !== exists.item_type) {
      if (await this.repository.hasTransactionHistory(context, id)) {
        throw new AthrDomainError(
          'CATALOG_ITEM_TYPE_CHANGE_RESTRICTED',
          `Variant ${id} has transaction history and cannot change item_type from "${exists.item_type}" to "${dto.item_type}" directly.`,
        );
      }
    }

    return this.repository.updateVariant(context, id, {
      sku: dto.sku ?? undefined,
      barcode_ean13: dto.barcode_ean13,
      barcode_internal: dto.barcode_internal,
      size: dto.size,
      color: dto.color,
      style: dto.style,
      item_type: dto.item_type,
      base_uom_id: dto.base_uom_id,
    });
  }

  async removeVariant(context: TenantContext, id: string) {
    const exists = await this.repository.findVariantById(context, id);
    if (!exists) throw new NotFoundException('Variant not found');
    const removed = await this.repository.updateVariant(context, id, { is_active: false });
    return removed;
  }
}
