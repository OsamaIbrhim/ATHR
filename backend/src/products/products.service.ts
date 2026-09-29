import { Injectable, NotFoundException } from '@nestjs/common';
import type { BarcodeKind, Prisma } from '@prisma/client';
import {
  BarcodeDto,
  CreateProductDto,
  UpdateBarcodeDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantInputDto,
} from './dto/product.dto';
import { ProductsRepository } from './products.repository';
import { BrandsRepository } from '../brands/brands.repository';
import { TaxCodeService } from '../tax/tax-code.service';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { TenantContext } from '../identity/tenant-context.type';
import { LimitService } from '../entitlements/limit.service';
import { quantityNumber } from '../common/quantity';
import { ProductTypesService, typeAttributes } from '../catalog/product-types.service';
import {
  parseVariantAttributes,
  variantLabel,
  type AttributeDefinition,
} from '../catalog/product-type-schema';
import { readTenantSettings } from '../catalog/tenant-settings';

@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly brands: BrandsRepository,
    private readonly tax: TaxCodeService,
    private readonly limits: LimitService,
    private readonly types: ProductTypesService,
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
    const [products, inventory, barcodes] = await Promise.all([
      this.repository.findProductsByIds(context, productIds),
      this.repository.findStockForVariants(context, variantIds, branchId),
      this.repository.findBarcodes(context, variantIds),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const barcodesByVariant = new Map<string, any[]>();
    for (const barcode of barcodes) {
      const rows = barcodesByVariant.get(barcode.variant_id) || [];
      rows.push({ ...barcode, pack_qty: quantityNumber(barcode.pack_qty) });
      barcodesByVariant.set(barcode.variant_id, rows);
    }
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
      barcodes: barcodesByVariant.get(variant.id) || [],
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
    // No type = a simple product: exactly one variant, no attributes.
    const type = dto.product_type_id ? await this.activeType(context, dto.product_type_id) : null;
    const definitions = type ? typeAttributes(type) : [];
    if (!type && dto.variants.length > 1) {
      throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', 'A product without a product type has exactly one variant.');
    }
    const variants = await Promise.all(dto.variants.map((variant) => this.variantRow(context, definitions, variant)));
    this.assertDistinctLabels(definitions, variants.map((row) => row.variant.label));

    const product = await this.repository.createProduct(
      context,
      {
        name_en: dto.name_en,
        name_ar: dto.name_ar,
        brand: dto.brand,
        brand_id: dto.brand_id,
        category_id: dto.category_id,
        product_type_id: type?.id,
        tax_category_id: taxCategoryId,
        has_variants: !!type,
      },
      variants.map(({ variant, barcodes }) => ({ ...variant, barcodes })),
    );
    return product;
  }

  /** An active product type of this tenant. */
  private async activeType(context: TenantContext, id: string) {
    const type = await this.types.get(context, id);
    if (!type.is_active) {
      throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', 'This product type is archived.');
    }
    return type;
  }

  /** Validates one variant input and builds its rows (attributes, label, barcodes). */
  private async variantRow(
    context: TenantContext,
    definitions: readonly AttributeDefinition[],
    input: VariantInputDto,
  ) {
    const attributes = parseVariantAttributes(definitions, input.attributes);
    const barcodes = await Promise.all((input.barcodes ?? []).map((barcode) => this.barcodeRow(context, barcode)));
    if (new Set(barcodes.map((barcode) => barcode.code)).size !== barcodes.length) {
      throw new AthrDomainError('CATALOG_BARCODE_CONFLICT', 'The same barcode is listed twice.');
    }
    return {
      variant: {
        sku: input.sku,
        cost_price: input.cost_price,
        item_type: input.item_type,
        base_uom_id: input.base_uom_id,
        attributes: attributes as Prisma.InputJsonValue,
        label: variantLabel(definitions, attributes),
      },
      barcodes,
    };
  }

  private assertDistinctLabels(definitions: readonly AttributeDefinition[], labels: string[]) {
    if (definitions.some((d) => d.axis) && new Set(labels).size !== labels.length) {
      throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', 'Two variants have the same attribute combination.');
    }
  }

  /**
   * A barcode row. A scale item code must look like the tenant's scale labels
   * (prefix + item digits) or a scanned label could never match it.
   */
  private async barcodeRow(context: TenantContext, input: BarcodeDto) {
    const kind: BarcodeKind = input.kind ?? 'standard';
    if (kind === 'scale_plu') await this.assertScalePlu(context, input.code, input.pack_qty);
    return { code: input.code, kind, pack_qty: input.pack_qty ?? 1 };
  }

  private async assertScalePlu(context: TenantContext, code: string, packQty?: number) {
    const { scale_barcode: scale } = readTenantSettings(await this.repository.tenantSettings(context));
    const expectedLength = 2 + scale.item_digits;
    if (
      !scale.enabled ||
      !/^\d+$/.test(code) ||
      code.length !== expectedLength ||
      !scale.prefixes.includes(code.slice(0, 2)) ||
      (packQty !== undefined && packQty !== 1)
    ) {
      throw new AthrDomainError(
        'REQUEST_FIELD_VALUE_INVALID',
        `A scale item code needs scale barcodes enabled and is ${expectedLength} digits starting with a scale prefix.`,
      );
    }
  }

  async getProduct(context: TenantContext, id: string) {
    const product = await this.repository.findProduct(context, id);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async updateProduct(context: TenantContext, id: string, dto: UpdateProductDto) {
    if (dto.brand_id) await this.brands.assertInTenant(context, dto.brand_id);
    const taxCategoryId = dto.tax_category_id
      ? await this.resolveTaxCategoryId(context, dto.tax_category_id)
      : undefined;
    const product = await this.repository.updateProduct(context, id, {
      name_en: dto.name_en,
      name_ar: dto.name_ar,
      brand_id: dto.brand_id,
      category_id: dto.category_id,
      tax_category_id: taxCategoryId,
    });
    return product;
  }

  /** Adds a variant (a new attribute combination) to a product that has a type. */
  async addVariant(context: TenantContext, productId: string, dto: VariantInputDto) {
    const product = await this.getProduct(context, productId);
    if (!product.product_type) {
      throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', 'A product without a product type has exactly one variant.');
    }
    const definitions = typeAttributes(product.product_type);
    const { variant, barcodes } = await this.variantRow(context, definitions, dto);
    if (product.variants.some((existing) => existing.label === variant.label)) {
      throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', 'This product already has a variant with this attribute combination.');
    }
    const created = await this.repository.addVariant(context, productId, variant, barcodes);
    return created;
  }

  async updateVariant(context: TenantContext, id: string, dto: UpdateVariantDto) {
    const exists = await this.repository.findVariantWithType(context, id);
    if (!exists) throw new NotFoundException('Variant not found');

    let attributeData: { attributes: Prisma.InputJsonValue; label: string } | undefined;
    if (dto.attributes) {
      const definitions = typeAttributes({ attributes: exists.product?.product_type?.attributes ?? [] });
      const attributes = parseVariantAttributes(definitions, dto.attributes);
      attributeData = { attributes: attributes as Prisma.InputJsonValue, label: variantLabel(definitions, attributes) };
    }

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

    const updated = await this.repository.updateVariant(context, id, {
      sku: dto.sku ?? undefined,
      ...attributeData,
      item_type: dto.item_type,
      base_uom_id: dto.base_uom_id,
    });
    return updated;
  }

  async addBarcode(context: TenantContext, variantId: string, dto: BarcodeDto) {
    return this.repository.addBarcode(context, variantId, await this.barcodeRow(context, dto));
  }

  async updateBarcode(context: TenantContext, id: string, dto: UpdateBarcodeDto) {
    const barcode = await this.repository.findBarcodeById(context, id);
    if (!barcode) throw new NotFoundException('Barcode not found');
    const kind = dto.kind ?? barcode.kind;
    if (kind === 'scale_plu') await this.assertScalePlu(context, barcode.code, dto.pack_qty);
    return this.repository.updateBarcode(context, id, { pack_qty: dto.pack_qty, kind: dto.kind });
  }

  removeBarcode(context: TenantContext, id: string) {
    return this.repository.removeBarcode(context, id);
  }

  async removeVariant(context: TenantContext, id: string) {
    const exists = await this.repository.findVariantById(context, id);
    if (!exists) throw new NotFoundException('Variant not found');
    const removed = await this.repository.updateVariant(context, id, { is_active: false });
    return removed;
  }
}
