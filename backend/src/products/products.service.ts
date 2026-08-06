import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto, UpdateVariantDto } from './dto/product.dto';
import { ProductsRepository } from './products.repository';
import { BrandsRepository } from '../brands/brands.repository';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class ProductsService {
  private readonly countCache = new Map<string, { expiresAt: number; value: Promise<number> }>();

  constructor(
    private readonly repository: ProductsRepository,
    private readonly brands: BrandsRepository,
  ) {}

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
      this.cachedCount(context, query, where),
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

  /**
   * Blueprint §125 "Cache Tests — keys contain Tenant": this cache was keyed
   * on the search string alone, so with more than one tenant the first
   * tenant's result count would be served to the second. The tenant id is now
   * part of the key.
   */
  private cachedCount(context: TenantContext, query: string, where: any) {
    const key = `${context.tenantId}:${query.toLocaleLowerCase('en-US')}`;
    const now = Date.now();
    const cached = this.countCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const ttl = Math.min(30_000, Math.max(0, Number(process.env.LIST_COUNT_CACHE_MS || 5_000)));
    let value: Promise<number>;
    value = this.repository.countVariants(context, where).then((total) => {
      if (this.countCache.get(key)?.value === value) {
        this.countCache.set(key, { expiresAt: Date.now() + ttl, value: Promise.resolve(total) });
      }
      return total;
    }).catch((error) => {
      if (this.countCache.get(key)?.value === value) this.countCache.delete(key);
      throw error;
    });
    this.countCache.set(key, { expiresAt: Number.POSITIVE_INFINITY, value });
    if (this.countCache.size > 200) this.countCache.delete(this.countCache.keys().next().value!);
    return value;
  }

  private invalidateCounts() {
    this.countCache.clear();
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
        ? variant.inventory.find((item: any) => item.branch_id === branchId)?.qty_on_hand || 0
        : undefined,
    };
    if (includeCost) return result;
    const { cost_price: _costPrice, ...safe } = result;
    return safe;
  }

  async createProduct(context: TenantContext, dto: CreateProductDto) {
    // BR-CLS-103 / BR-PROD-100: a cross-tenant brand_id must never be
    // accepted -- fail loudly here rather than relying solely on the
    // composite FK to reject it at the DB layer.
    if (dto.brand_id) {
      await this.brands.assertInTenant(context, dto.brand_id);
    }
    const product = await this.repository.saveProduct(context, {
      name_en: dto.name_en,
      name_ar: dto.name_ar,
      brand: dto.brand,
      brand_id: dto.brand_id,
      category_id: dto.category_id,
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
    this.invalidateCounts();
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
    this.invalidateCounts();
    return removed;
  }
}
