import { BadRequestException, Injectable } from '@nestjs/common';
import type { Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { TaxResolutionService } from '../tax/tax-resolution.service';
import type { TenantContext } from '../identity/tenant-context.type';

/**
 * Prisma's automatic relation loader for `include: { product: true }` fans
 * out into a Postgres statement that exceeds `max_stack_depth` once the
 * parent result set is unbounded and large (confirmed at ~10k rows; safe at
 * ~100). A flat `id IN (...)` batch is a different, well-understood query
 * shape that does not hit this. Batch defensively rather than assume an
 * unbounded array is safe at any catalog size.
 *
 * Exported so `verify-sync-snapshot-behaviour.cjs` (migration-gate) imports
 * this value instead of restating it -- a copy in two files can drift
 * silently and the CI proof would then be checking a different chunk size
 * than the one actually shipped.
 */
export const PRODUCT_BATCH_SIZE = 1_000;

@Injectable()
export class SyncService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private tax: TaxResolutionService,
  ) {}

  private catalogValidUntil(now = Date.now()) {
    const configured = Number(process.env.POS_PRICE_CATALOG_TTL_MS || 86_400_000);
    const ttl = Number.isFinite(configured) && configured >= 60_000 ? configured : 86_400_000;
    return new Date(now + ttl).toISOString();
  }

  async pull(context: TenantContext, branchId: string, cursor?: string) {
    if (!cursor) return this.snapshot(context, branchId);
    let parsedCursor: bigint;
    try {
      parsedCursor = BigInt(cursor);
      if (parsedCursor < 0n) throw new Error('negative');
    } catch {
      throw new BadRequestException('cursor must be a non-negative integer');
    }

    const changes = await this.prisma.syncChange.findMany({
      where: {
        tenant_id: context.tenantId,
        sequence: { gt: parsedCursor },
        OR: [{ branch_id: null }, { branch_id: branchId }],
      },
      orderBy: { sequence: 'asc' },
      take: 5_000,
    });
    const issuedAt = new Date().toISOString();
    const catalogValidUntil = this.catalogValidUntil();
    const sellers = await this.sellers(context, branchId);
    if (!changes.length) {
      return {
        mode: 'delta', cursor, server_time: issuedAt,
        catalog_valid_until: catalogValidUntil,
        products: [], stock: [], deleted_variant_ids: [],
        sellers, reset_sellers: true,
        reset_products: false, reset_stock: false, has_more: false,
      };
    }

    const resetCatalog = changes.some((change) => change.kind === 'product' || change.kind === 'pricing');
    const requestedIds = new Set(
      changes
        .filter((change) => change.kind === 'variant' || change.kind === 'inventory')
        .map((change) => change.entity_key)
        .filter((value): value is string => !!value),
    );
    const [variantRows, stock, rules, taxCodes] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: {
          tenant_id: context.tenantId,
          product: { is_active: true, tenant_id: context.tenantId },
          is_active: true,
          ...(resetCatalog ? {} : { id: { in: [...requestedIds] } }),
        },
      }),
      this.prisma.inventoryStock.findMany({
        where: {
          tenant_id: context.tenantId,
          branch_id: branchId,
          ...(resetCatalog ? {} : { variant_id: { in: [...requestedIds] } }),
        },
      }),
      this.pricing.loadActiveRules(context),
      this.tax.loadActiveCodeIndex(context),
    ]);
    const variants = await this.attachProducts(context, variantRows);
    const presentIds = new Set(variants.map((variant) => variant.id));
    const deletedVariantIds = resetCatalog ? [] : [...requestedIds].filter((id) => !presentIds.has(id));
    const quotes = this.pricing.quoteMany(variants, rules, taxCodes);
    // WP-008 Phase B (BR-PSL-101): a variant with no resolvable price is
    // omitted from `quotes` rather than throwing (unlike `calculate`) --
    // the offline catalog snapshot must not fail entirely for one unpriced
    // item. It is simply not advertised to POS until it is priced.
    const products = variants
      .filter((variant) => quotes.has(variant.id))
      .map((variant) => this.productSnapshot(variant, quotes.get(variant.id)!, issuedAt));

    return {
      mode: 'delta',
      cursor: changes[changes.length - 1].sequence.toString(),
      server_time: issuedAt,
      catalog_valid_until: catalogValidUntil,
      products, stock, deleted_variant_ids: deletedVariantIds,
      reset_products: resetCatalog, reset_stock: resetCatalog,
      sellers, reset_sellers: true,
      has_more: changes.length === 5_000,
    };
  }

  private async snapshot(context: TenantContext, branchId: string) {
    const cursor = await this.prisma.syncChange.aggregate({
      where: { tenant_id: context.tenantId },
      _max: { sequence: true },
    });
    const [variantRows, stock, rules, sellers, taxCodes] = await Promise.all([
      this.prisma.productVariant.findMany({
        where: {
          tenant_id: context.tenantId,
          is_active: true,
          product: { is_active: true, tenant_id: context.tenantId },
        },
      }),
      this.prisma.inventoryStock.findMany({
        where: { tenant_id: context.tenantId, branch_id: branchId },
      }),
      this.pricing.loadActiveRules(context),
      this.sellers(context, branchId),
      this.tax.loadActiveCodeIndex(context),
    ]);
    const variants = await this.attachProducts(context, variantRows);
    const issuedAt = new Date().toISOString();
    const quotes = this.pricing.quoteMany(variants, rules, taxCodes);
    const products = variants
      .filter((variant) => quotes.has(variant.id))
      .map((variant) => this.productSnapshot(variant, quotes.get(variant.id)!, issuedAt));
    return {
      mode: 'snapshot',
      cursor: (cursor._max.sequence || 0n).toString(),
      server_time: issuedAt,
      catalog_valid_until: this.catalogValidUntil(),
      products, stock, deleted_variant_ids: [],
      sellers, reset_sellers: true,
      reset_products: true, reset_stock: true, has_more: false,
    };
  }

  /**
   * Replaces Prisma's automatic `include: { product: true }` relation loader,
   * which exceeds Postgres's max_stack_depth once the parent variant set is
   * unbounded and large (confirmed at CI catalog volume). The product batch
   * query is deliberately unfiltered on `is_active` (only tenant_id + id) so
   * a product deactivated between the two queries cannot strand a variant
   * the first query already committed to returning -- the throw below is a
   * true invariant guard, not a race that's merely unlikely to fire.
   *
   * Honest note on WHY, not just that: this was isolated behaviourally, not
   * diagnosed to a Postgres/Prisma internal cause. Bisecting the failing
   * statement against a real `postgres:16` instance showed: the plain
   * variant filter query alone (no `include`) succeeds at 10k+ rows; the
   * same query plus `include: { product: true }` fails identically with
   * Postgres error 54001 whether concurrent or not; the same query plus
   * `include` bounded to `take: 100` succeeds. That isolates the *trigger*
   * (Prisma's relation-loader fan-out over an unbounded parent set) but not
   * the mechanism inside Postgres's executor that actually exhausts the
   * C stack for that access pattern. The fix below takes a categorically
   * different, independently-bisected-safe query shape (a flat `id IN (...)`
   * batch has no JOIN, no relation-loader fan-out, and was separately
   * confirmed safe at the same row count) rather than tuning the unsafe one,
   * so it does not depend on ever fully explaining the internal cause.
   */
  private async attachProducts<T extends { readonly id: string; readonly product_id: string }>(
    context: TenantContext,
    variants: readonly T[],
  ): Promise<(T & { readonly product: Product })[]> {
    const productIds = [...new Set(variants.map((variant) => variant.product_id))];
    const productsById = new Map<string, Product>();
    for (let offset = 0; offset < productIds.length; offset += PRODUCT_BATCH_SIZE) {
      const chunk = productIds.slice(offset, offset + PRODUCT_BATCH_SIZE);
      const products = await this.prisma.product.findMany({
        where: { tenant_id: context.tenantId, id: { in: chunk } },
      });
      for (const product of products) productsById.set(product.id, product);
    }
    return variants.map((variant) => {
      const product = productsById.get(variant.product_id);
      if (!product) {
        throw new Error(
          `SyncService: active product ${variant.product_id} not found for active variant ${variant.id}; the variant query's product filter invariant broke.`,
        );
      }
      return { ...variant, product };
    });
  }

  private sellers(context: TenantContext, branchId: string) {
    const users = (this.prisma as any).user;
    if (!users) return Promise.resolve([]);
    return users.findMany({
      where: {
        // User has no tenant_id column (ADR-0003); scope through Membership.
        memberships: { some: { tenantId: context.tenantId } },
        branch_id: branchId,
        role: 'seller',
        is_active: true,
      },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  private productSnapshot(
    variant: any,
    quote: ReturnType<PricingService['quote']>,
    issuedAt: string,
  ) {
    return {
      catalog_version: 2,
      id: variant.id,
      sku: variant.sku,
      name_en: variant.product.name_en,
      name_ar: variant.product.name_ar,
      barcode_ean13: variant.barcode_ean13,
      barcode_internal: variant.barcode_internal,
      size: variant.size,
      color: variant.color,
      selling_price: quote.net_price,
      unit_tax: quote.tax_amount,
      price_issued_at: issuedAt,
    };
  }
}
