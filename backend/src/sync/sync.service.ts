import { BadRequestException, Injectable } from '@nestjs/common';
import type { Product, ProductBarcode, ProductVariant, UnitOfMeasure } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { TaxResolutionService } from '../tax/tax-resolution.service';
import type { TenantContext } from '../identity/tenant-context.type';
import { InventoryService } from '../inventory/inventory.service';
import { quantityNumber } from '../common/quantity';
import { readTenantSettings } from '../catalog/tenant-settings';
import {
  compareCursors,
  formatCursor,
  parseCursor,
  type SyncCursor,
} from './sync-cursor';

/**
 * Prisma's automatic relation loader for `include: { product: true }` fans
 * out into a Postgres statement that exceeds `max_stack_depth` once the
 * parent result set is unbounded and large. A flat `id IN (...)` batch is a
 * different, well-understood query shape that does not hit this; product
 * batches are therefore bounded. Exported so `verify-sync-snapshot-behaviour.cjs`
 * imports this value instead of restating it.
 */
export const PRODUCT_BATCH_SIZE = 1_000;

/** Variants per snapshot page (keyset on variant id). */
export const SNAPSHOT_PAGE_SIZE = 1_000;

/** Changes read per delta pull. */
export const DELTA_CHANGE_LIMIT = 5_000;

/** The catalog wire format the POS caches; bumped when the payload shape changes. */
export const CATALOG_VERSION = 3;

export interface PullQuery {
  /** The cursor the POS has applied up to; absent = take a snapshot. */
  readonly cursor?: string;
  /** Snapshot continuation: last variant id received, and the cursor the snapshot started at. */
  readonly snapshot_after?: string;
  readonly snapshot_cursor?: string;
}

interface ChangeRow {
  readonly txid: string;
  readonly sequence: bigint;
  readonly kind: string;
  readonly entity_key: string | null;
}

interface TerminalRef {
  readonly id: string;
  readonly sync_cursor: string | null;
}

@Injectable()
export class SyncService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private tax: TaxResolutionService,
    private inventory: InventoryService,
  ) {}

  /**
   * One pull: a snapshot page (no cursor, or continuing a snapshot) or a
   * delta of the entities that changed since the POS's cursor.
   */
  async pull(context: TenantContext, branchId: string, query: PullQuery = {}, terminal?: TerminalRef) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: context.tenantId },
      select: { settings: true, sync_floor: true },
    });
    const settings = readTenantSettings(tenant.settings);
    const floor = parseCursor(tenant.sync_floor);

    if (query.snapshot_after !== undefined) {
      if (!query.snapshot_cursor) throw new BadRequestException('snapshot_cursor is required with snapshot_after');
      parseCursor(query.snapshot_cursor);
      return this.snapshotPage(context, branchId, settings, query.snapshot_after || null, query.snapshot_cursor);
    }
    if (!query.cursor) {
      const head = (await this.headCursor(context.tenantId)) ?? floor;
      return this.snapshotPage(context, branchId, settings, null, formatCursor(head));
    }

    const cursor = parseCursor(query.cursor);
    if (terminal && terminal.sync_cursor !== query.cursor) {
      // The POS states what it has applied; compaction never removes anything above the lowest such cursor.
      await this.prisma.posTerminal.updateMany({
        where: { id: terminal.id, tenant_id: context.tenantId },
        data: { sync_cursor: query.cursor },
      });
    }
    // Compaction removed changes this POS never saw: it must start over.
    if (compareCursors(cursor, floor) < 0) {
      const head = (await this.headCursor(context.tenantId)) ?? floor;
      return this.snapshotPage(context, branchId, settings, null, formatCursor(head));
    }
    return this.delta(context, branchId, settings, cursor);
  }

  /** The newest change whose transaction has finished, or null when there is none. */
  private async headCursor(tenantId: string): Promise<SyncCursor | null> {
    const [head] = await this.prisma.$queryRaw<Array<{ txid: string; sequence: bigint }>>`
      SELECT "txid"::text AS txid, "sequence"
      FROM "SyncChange"
      WHERE "tenant_id" = ${tenantId}::uuid
        AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
      ORDER BY "txid" DESC, "sequence" DESC
      LIMIT 1`;
    return head ? { txid: BigInt(head.txid), sequence: head.sequence } : null;
  }

  /**
   * Changes after `cursor` that this branch should see. Only changes of
   * finished transactions are returned (txid below the snapshot's xmin), in
   * (txid, sequence) order, so a transaction that commits after this read
   * always sorts after everything already handed out.
   */
  private readChanges(tenantId: string, branchId: string, cursor: SyncCursor): Promise<ChangeRow[]> {
    return this.prisma.$queryRaw<ChangeRow[]>`
      SELECT "txid"::text AS txid, "sequence", "kind", "entity_key"
      FROM "SyncChange"
      WHERE "tenant_id" = ${tenantId}::uuid
        AND ("branch_id" IS NULL OR "branch_id" = ${branchId}::uuid)
        AND ("txid", "sequence") > (${cursor.txid.toString()}::text::xid8, ${cursor.sequence}::bigint)
        AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
      ORDER BY "txid", "sequence"
      LIMIT ${DELTA_CHANGE_LIMIT}`;
  }

  private async delta(
    context: TenantContext,
    branchId: string,
    settings: ReturnType<typeof readTenantSettings>,
    cursor: SyncCursor,
  ) {
    const changes = await this.readChanges(context.tenantId, branchId, cursor);
    const issuedAt = new Date().toISOString();
    const base = {
      catalog_version: CATALOG_VERSION,
      mode: 'delta' as const,
      server_time: issuedAt,
      catalog_valid_until: this.catalogValidUntil(),
      products: [] as unknown[],
      stock: [] as unknown[],
      deleted_variant_ids: [] as string[],
      reset_products: false,
      reset_stock: false,
      reset_sellers: false,
      has_more: false,
    };
    if (!changes.length) return { ...base, cursor: formatCursor(cursor) };

    const last = changes[changes.length - 1];
    const newCursor = formatCursor({ txid: BigInt(last.txid), sequence: last.sequence });

    // A rule, tax or wide price change touches many prices: start a fresh snapshot.
    if (changes.some((change) => change.kind === 'pricing')) {
      return this.snapshotPage(context, branchId, settings, null, newCursor);
    }

    const keys = (kind: string) => [
      ...new Set(changes.filter((c) => c.kind === kind && c.entity_key).map((c) => c.entity_key as string)),
    ];
    const variantIds = keys('variant');
    const productIds = keys('product');
    const uomIds = keys('uom');
    const stockIds = keys('inventory');
    const has = (kind: string) => changes.some((change) => change.kind === kind);

    const clauses = [
      variantIds.length ? { id: { in: variantIds } } : null,
      productIds.length ? { product_id: { in: productIds } } : null,
      uomIds.length ? { base_uom_id: { in: uomIds } } : null,
    ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);
    const found = clauses.length
      ? await this.prisma.productVariant.findMany({ where: { tenant_id: context.tenantId, OR: clauses } })
      : [];

    const { products, presentIds } = await this.catalogRows(context, found.filter((v) => v.is_active));
    const candidateIds = new Set([...variantIds, ...found.map((variant) => variant.id)]);
    const deleted = [...candidateIds].filter((id) => !presentIds.has(id));
    const stock = await this.branchStock(context, branchId, [...new Set([...stockIds, ...presentIds])]);

    return {
      ...base,
      cursor: newCursor,
      products,
      stock,
      deleted_variant_ids: deleted,
      has_more: changes.length === DELTA_CHANGE_LIMIT,
      ...(has('sellers') ? { sellers: await this.sellers(context, branchId), reset_sellers: true } : {}),
      ...(has('settings') ? { settings } : {}),
    };
  }

  /**
   * One page of the first-time (or restart) snapshot: variants ordered by id,
   * `SNAPSHOT_PAGE_SIZE` at a time. `snapshot_cursor` is the stream position
   * when the snapshot started; the POS continues from it with a delta after
   * the last page, and can resume a half-done snapshot with `snapshot_after`.
   */
  private async snapshotPage(
    context: TenantContext,
    branchId: string,
    settings: ReturnType<typeof readTenantSettings>,
    after: string | null,
    snapshotCursor: string,
  ) {
    const first = after === null;
    const rows = await this.prisma.productVariant.findMany({
      where: {
        tenant_id: context.tenantId,
        is_active: true,
        product: { is_active: true, tenant_id: context.tenantId },
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: 'asc' },
      take: SNAPSHOT_PAGE_SIZE + 1,
    });
    const hasMore = rows.length > SNAPSHOT_PAGE_SIZE;
    const page = rows.slice(0, SNAPSHOT_PAGE_SIZE);

    const [{ products }, stock, sellers] = await Promise.all([
      this.catalogRows(context, page),
      this.branchStock(context, branchId, page.map((variant) => variant.id)),
      first ? this.sellers(context, branchId) : undefined,
    ]);
    const issuedAt = new Date().toISOString();
    return {
      catalog_version: CATALOG_VERSION,
      mode: 'snapshot' as const,
      cursor: snapshotCursor,
      server_time: issuedAt,
      catalog_valid_until: this.catalogValidUntil(),
      products,
      stock,
      deleted_variant_ids: [] as string[],
      snapshot_after: hasMore ? page[page.length - 1].id : null,
      has_more: hasMore,
      reset_products: first,
      reset_stock: first,
      reset_sellers: first,
      ...(first ? { sellers, settings } : {}),
    };
  }

  /**
   * The POS rows for some active variants: product names, unit, barcodes and
   * the quoted price. A variant with no resolvable price is left out (BR-PSL-101):
   * the catalog must not fail for one unpriced item, and it is not advertised
   * until it is priced.
   */
  private async catalogRows(context: TenantContext, variantRows: readonly ProductVariant[]) {
    if (!variantRows.length) return { products: [], presentIds: new Set<string>() };
    const productsById = await this.loadProducts(context, variantRows);
    const usable = variantRows.filter((variant) => productsById.get(variant.product_id)?.is_active);
    const variants = usable.map((variant) => ({ ...variant, product: productsById.get(variant.product_id)! }));

    const uomIds = [...new Set(variants.map((v) => v.base_uom_id).filter((id): id is string => !!id))];
    const [barcodes, uoms, rules, taxCodes] = await Promise.all([
      this.prisma.productBarcode.findMany({
        where: { tenant_id: context.tenantId, variant_id: { in: variants.map((v) => v.id) } },
        orderBy: { created_at: 'asc' },
      }),
      uomIds.length
        ? this.prisma.unitOfMeasure.findMany({ where: { tenant_id: context.tenantId, id: { in: uomIds } } })
        : Promise.resolve([] as UnitOfMeasure[]),
      this.pricing.loadActiveRules(context, undefined, variants),
      this.tax.loadActiveCodeIndex(context),
    ]);
    const barcodesByVariant = new Map<string, ProductBarcode[]>();
    for (const barcode of barcodes) {
      barcodesByVariant.set(barcode.variant_id, [...(barcodesByVariant.get(barcode.variant_id) ?? []), barcode]);
    }
    const uomById = new Map(uoms.map((uom) => [uom.id, uom]));

    const quotes = this.pricing.quoteMany(variants, rules, taxCodes);
    const issuedAt = new Date().toISOString();
    const priced = variants.filter((variant) => quotes.has(variant.id));
    return {
      presentIds: new Set(priced.map((variant) => variant.id)),
      products: priced.map((variant) =>
        this.productSnapshot(
          variant,
          quotes.get(variant.id)!,
          barcodesByVariant.get(variant.id) ?? [],
          variant.base_uom_id ? uomById.get(variant.base_uom_id) : undefined,
          issuedAt,
        ),
      ),
    };
  }

  /** A branch's POS stock is its default warehouse; the branch id is stamped on every row. */
  private async branchStock(context: TenantContext, branchId: string, variantIds: string[]) {
    if (!variantIds.length) return [];
    const warehouseId = await this.inventory.defaultWarehouseId(this.prisma, context.tenantId, branchId);
    const rows = await this.prisma.inventoryStock.findMany({
      where: { tenant_id: context.tenantId, warehouse_id: warehouseId, variant_id: { in: variantIds } },
      select: { variant_id: true, qty_on_hand: true, qty_reserved: true, last_sold_at: true },
    });
    return rows.map((row) => ({
      branch_id: branchId,
      variant_id: row.variant_id,
      qty_on_hand: quantityNumber(row.qty_on_hand),
      qty_reserved: quantityNumber(row.qty_reserved),
      last_sold_at: row.last_sold_at,
    }));
  }

  private catalogValidUntil(now = Date.now()) {
    const configured = Number(process.env.POS_PRICE_CATALOG_TTL_MS || 86_400_000);
    const ttl = Number.isFinite(configured) && configured >= 60_000 ? configured : 86_400_000;
    return new Date(now + ttl).toISOString();
  }

  /**
   * Loads the parents of some variants in flat `id IN (...)` batches (see
   * PRODUCT_BATCH_SIZE). The batch query is deliberately unfiltered on
   * `is_active` (tenant + id only) so a product deactivated between two reads
   * cannot strand a variant the first read already returned.
   */
  private async loadProducts(context: TenantContext, variants: readonly ProductVariant[]) {
    const productIds = [...new Set(variants.map((variant) => variant.product_id))];
    const productsById = new Map<string, Product>();
    for (let offset = 0; offset < productIds.length; offset += PRODUCT_BATCH_SIZE) {
      const chunk = productIds.slice(offset, offset + PRODUCT_BATCH_SIZE);
      const products = await this.prisma.product.findMany({
        where: { tenant_id: context.tenantId, id: { in: chunk } },
      });
      for (const product of products) productsById.set(product.id, product);
    }
    return productsById;
  }

  /** The branch's active sellers: `seller` Memberships scoped to the branch. */
  private async sellers(context: TenantContext, branchId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: {
        tenant_id: context.tenantId,
        role: 'seller',
        access_scope_assignments: { some: { scope_type: 'location', scope_ref_id: branchId } },
        user: { is_active: true },
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: [{ user: { name: 'asc' } }, { user_id: 'asc' }],
    });
    return memberships.map(({ user }) => user);
  }

  private productSnapshot(
    variant: any,
    quote: ReturnType<PricingService['quote']>,
    barcodes: ProductBarcode[],
    uom: UnitOfMeasure | undefined,
    issuedAt: string,
  ) {
    return {
      catalog_version: CATALOG_VERSION,
      id: variant.id,
      sku: variant.sku,
      name_en: variant.product.name_en,
      name_ar: variant.product.name_ar,
      label: variant.label,
      attributes: variant.attributes,
      // W2b: additive field; a POS that predates it ignores it and sells the item untracked.
      tracking: variant.tracking,
      uom_code: uom?.code ?? null,
      uom_name_ar: uom?.name_ar ?? null,
      uom_precision: uom?.precision ?? 0,
      barcodes: barcodes.map((barcode) => ({
        code: barcode.code,
        pack_qty: quantityNumber(barcode.pack_qty),
        kind: barcode.kind,
      })),
      selling_price: quote!.net_price,
      unit_tax: quote!.tax_amount,
      price_issued_at: issuedAt,
    };
  }
}
