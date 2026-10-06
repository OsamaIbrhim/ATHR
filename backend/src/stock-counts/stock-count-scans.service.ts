import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { CONFLICT, domainError } from '../common/domain-error';
import { quantityNumber } from '../common/quantity';
import type { CountScope } from './stock-count-scope';
import type { CountEntriesDto, CountEntryDto } from './dto/stock-count.dto';

type Tx = Prisma.TransactionClient;
type Header = CountScope & { id: string; status: string; branch_id: string; warehouse_id: string };
type VariantInfo = {
  id: string;
  sku: string;
  label: string;
  is_active: boolean;
  item_type: string;
  tracking: string;
  precision: number;
  name_ar: string | null;
  name_en: string | null;
  product_active: boolean;
  category_id: string | null;
  product_type_id: string | null;
};
type Planned = {
  entry: CountEntryDto;
  status: string;
  variant: VariantInfo | null;
  barcode: string | null;
  packQty: number | null;
  /** Change of this counter's total for the item (null = nothing to store). */
  delta: Prisma.Decimal | null;
};

const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;
const ZERO = new Prisma.Decimal(0);

/** Statuses that say why a scan was not counted (the client shows `message_ar`). */
const REFUSALS: Record<string, { message: string; message_ar: string }> = {
  unknown_barcode: { message: 'Unknown barcode', message_ar: 'باركود غير معروف.' },
  variant_not_found: { message: 'Item not found', message_ar: 'الصنف غير موجود.' },
  not_countable: { message: 'This item holds no stock', message_ar: 'هذا الصنف لا يحتفظ برصيد مخزون.' },
  tracked_not_supported: { message: 'Serial and batch items cannot be counted here yet', message_ar: 'الأصناف المتتبَّعة لا تُجرد هنا حاليًا.' },
  out_of_scope: { message: 'This item is outside the count scope', message_ar: 'هذا الصنف خارج نطاق الجرد.' },
  precision_exceeded: { message: 'Too many decimals for this unit', message_ar: 'الكمية تحتوي على كسور أكثر مما تسمح به وحدة القياس.' },
  below_zero: { message: 'Your total for this item cannot go below zero', message_ar: 'لا يمكن أن يقل عدّك لهذا الصنف عن صفر.' },
  invalid_quantity: { message: 'Quantity is missing or invalid', message_ar: 'الكمية غير صالحة.' },
};

/**
 * Counting: each scan is an idempotent event. One batch of entries is a fixed
 * number of statements (lock, barcode and variant lookups, one insert of the
 * events, one insert of new lines, one update of the totals, one read back),
 * however many entries it carries, so a phone can flush its offline queue in
 * one request.
 */
@Injectable()
export class StockCountScansService {
  constructor(private readonly prisma: PrismaService) {}

  async record(context: TenantContext, countId: string, dto: CountEntriesDto, actor: AuthenticatedUser) {
    const canAddOutside = actor.permissions.has('inventory.adjustment.approve');
    const results = await this.prisma.$transaction(async (tx) => {
      const header = await this.lockShared(tx, context, countId);
      assertBranchAccess(actor, header.branch_id);
      if (header.status !== 'open') throw this.closed(header.status);

      const { variants, packs, resolved } = await this.lookup(tx, context.tenantId, dto.entries);
      const variantIds = [...variants.keys()];
      const mine = await this.myTotals(tx, context.tenantId, countId, actor.sub, variantIds);
      const planned = this.plan(dto.entries, { header, variants, packs, resolved, mine, canAddOutside });

      const stored = planned.filter((item) => item.status === 'counted' || item.status === 'unknown_barcode');
      const inserted = await this.insertEntries(tx, context.tenantId, countId, actor.sub, stored);
      const applied = stored.filter((item) => inserted.has(item.entry.entry_id) && item.variant && item.delta);
      await this.applyToLines(tx, context.tenantId, header, applied);

      const touched = [...new Set(planned.flatMap((item) => (item.variant ? [item.variant.id] : [])))];
      const totals = await this.lineTotals(tx, context.tenantId, countId, touched);
      const mineAfter = await this.myTotals(tx, context.tenantId, countId, actor.sub, touched);
      return planned.map((item) => this.present(item, inserted, totals, mineAfter));
    }, TX_OPTIONS);
    return { count_id: countId, results };
  }

  /** Clears the count of one item (all counters) so it can be counted again. */
  async resetLine(context: TenantContext, countId: string, variantId: string, actor: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const header = await this.lockShared(tx, context, countId);
      assertBranchAccess(actor, header.branch_id);
      if (header.status !== 'open') throw this.closed(header.status);
      await tx.stockCountEntry.deleteMany({ where: { tenant_id: context.tenantId, count_id: countId, variant_id: variantId } });
      await tx.stockCountLine.deleteMany({ where: { tenant_id: context.tenantId, count_id: countId, variant_id: variantId } });
      await tx.auditLog.create({
        data: { tenant_id: context.tenantId, user_id: actor.sub, action: 'stock_count.line_reset', entity: 'StockCount', entity_id: countId, meta: { variant_id: variantId } },
      });
    }, TX_OPTIONS);
    return { count_id: countId, variant_id: variantId, reset: true };
  }

  // --- internals --------------------------------------------------------------

  private closed(status: string) {
    return domainError(CONFLICT, 'STOCK_COUNT_CLOSED', `This count is ${status} and no longer accepts counting`, 'هذا الجرد أُغلق ولم يعد يقبل العدّ.', { status });
  }

  /** A shared lock: scans run together, but not while the count is being posted or cancelled. */
  private async lockShared(tx: Tx, context: TenantContext, id: string): Promise<Header> {
    const [header] = await tx.$queryRaw<Header[]>`
      SELECT "id", "status"::text AS "status", "branch_id", "warehouse_id",
             "scope_type"::text AS "scope_type", "category_id", "product_type_id"
      FROM "StockCount"
      WHERE "id" = ${id}::uuid AND "tenant_id" = ${context.tenantId}::uuid
      FOR SHARE
    `;
    if (!header) throw new NotFoundException('Stock count not found');
    return header;
  }

  private async lookup(tx: Tx, tenantId: string, entries: CountEntryDto[]) {
    const codes = [...new Set(entries.flatMap((entry) => (entry.barcode ? [entry.barcode] : [])))];
    const barcodeRows = codes.length
      ? await tx.productBarcode.findMany({
          where: { tenant_id: tenantId, code: { in: codes } },
          select: { code: true, variant_id: true, pack_qty: true, kind: true },
        })
      : [];
    const resolved = new Map(barcodeRows.map((row) => [row.code, row]));
    const packs = new Map(barcodeRows.map((row) => [row.code, row.kind === 'scale_plu' ? 1 : Number(row.pack_qty)]));
    const ids = new Set([...entries.flatMap((entry) => (entry.variant_id ? [entry.variant_id] : [])), ...barcodeRows.map((row) => row.variant_id)]);
    const rows = ids.size
      ? await tx.productVariant.findMany({
          where: { tenant_id: tenantId, id: { in: [...ids] } },
          select: {
            id: true,
            sku: true,
            label: true,
            is_active: true,
            item_type: true,
            tracking: true,
            base_uom: { select: { precision: true } },
            product: { select: { name_ar: true, name_en: true, is_active: true, category_id: true, product_type_id: true } },
          },
        })
      : [];
    const variants = new Map<string, VariantInfo>(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          sku: row.sku,
          label: row.label,
          is_active: row.is_active,
          item_type: row.item_type,
          tracking: row.tracking,
          precision: row.base_uom?.precision ?? 0,
          name_ar: row.product?.name_ar ?? null,
          name_en: row.product?.name_en ?? null,
          product_active: row.product?.is_active ?? false,
          category_id: row.product?.category_id ?? null,
          product_type_id: row.product?.product_type_id ?? null,
        },
      ]),
    );
    return { variants, packs, resolved };
  }

  /** This counter's running total per item (the base of "set" and of undo). */
  private async myTotals(tx: Tx, tenantId: string, countId: string, userId: string, variantIds: string[]) {
    if (!variantIds.length) return new Map<string, Prisma.Decimal>();
    const rows = await tx.$queryRaw<Array<{ variant_id: string; total: Prisma.Decimal }>>`
      SELECT "variant_id", SUM("qty_delta") AS "total"
      FROM "StockCountEntry"
      WHERE "tenant_id" = ${tenantId}::uuid AND "count_id" = ${countId}::uuid
        AND "counted_by" = ${userId}::uuid AND "variant_id" = ANY(${variantIds}::uuid[])
      GROUP BY "variant_id"
    `;
    return new Map(rows.map((row) => [row.variant_id, row.total]));
  }

  /** Decides what each entry means, in order, tracking this counter's running totals inside the batch. */
  private plan(
    entries: CountEntryDto[],
    ctx: {
      header: Header;
      variants: Map<string, VariantInfo>;
      packs: Map<string, number>;
      resolved: Map<string, { variant_id: string }>;
      mine: Map<string, Prisma.Decimal>;
      canAddOutside: boolean;
    },
  ): Planned[] {
    const running = new Map(ctx.mine);
    const seenKeys = new Set<string>();
    return entries.map((entry): Planned => {
      const refuse = (status: string, variant: VariantInfo | null = null): Planned => ({
        entry, status, variant, barcode: entry.barcode ?? null, packQty: null, delta: null,
      });
      if (seenKeys.has(entry.entry_id)) return refuse('duplicate');
      seenKeys.add(entry.entry_id);

      const variantId = entry.variant_id ?? ctx.resolved.get(entry.barcode ?? '')?.variant_id;
      if (!variantId) {
        // Kept (variant null) so the review can list what could not be matched.
        return { entry, status: 'unknown_barcode', variant: null, barcode: entry.barcode ?? null, packQty: null, delta: entry.mode === 'set' ? ZERO : this.asDecimal(entry.qty ?? 1) };
      }
      const variant = ctx.variants.get(variantId);
      if (!variant) return refuse('variant_not_found');
      if (variant.item_type !== 'stocked' || !variant.is_active || !variant.product_active) return refuse('not_countable', variant);
      if (variant.tracking !== 'none') return refuse('tracked_not_supported', variant);
      if (!this.inScope(ctx.header, variant) && !(entry.allow_out_of_scope && ctx.canAddOutside)) return refuse('out_of_scope', variant);

      const pack = entry.barcode ? (ctx.packs.get(entry.barcode) ?? 1) : 1;
      const current = running.get(variant.id) ?? ZERO;
      let delta: Prisma.Decimal;
      if ((entry.mode ?? 'add') === 'set') {
        if (entry.qty === undefined || entry.qty < 0) return refuse('invalid_quantity', variant);
        delta = this.asDecimal(entry.qty).minus(current);
      } else {
        delta = this.asDecimal(entry.qty ?? 1).mul(pack);
        if (delta.isZero()) return refuse('invalid_quantity', variant);
      }
      if (delta.decimalPlaces() > variant.precision) return refuse('precision_exceeded', variant);
      if (current.plus(delta).isNegative()) return refuse('below_zero', variant);
      running.set(variant.id, current.plus(delta));
      return { entry, status: 'counted', variant, barcode: entry.barcode ?? null, packQty: entry.barcode ? pack : null, delta };
    });
  }

  private asDecimal(value: number) {
    return new Prisma.Decimal(value);
  }

  private inScope(header: CountScope, variant: VariantInfo): boolean {
    if (header.scope_type === 'category') return variant.category_id === header.category_id;
    if (header.scope_type === 'product_type') return variant.product_type_id === header.product_type_id;
    return true;
  }

  /** Stores the events; returns the keys that were new (the others are retries of earlier events). */
  private async insertEntries(tx: Tx, tenantId: string, countId: string, userId: string, items: Planned[]) {
    if (!items.length) return new Set<string>();
    const rows = await tx.$queryRaw<Array<{ entry_key: string }>>`
      INSERT INTO "StockCountEntry" ("id", "tenant_id", "count_id", "entry_key", "variant_id", "barcode", "qty_delta", "counted_by")
      SELECT gen_random_uuid(), ${tenantId}::uuid, ${countId}::uuid, u."key", NULLIF(u."variant", '')::uuid, NULLIF(u."barcode", ''), u."delta", ${userId}::uuid
      FROM unnest(
        ${items.map((item) => item.entry.entry_id)}::text[],
        ${items.map((item) => item.variant?.id ?? '')}::text[],
        ${items.map((item) => item.barcode ?? '')}::text[],
        ${items.map((item) => (item.delta ?? ZERO).toFixed(3))}::numeric[]
      ) AS u("key", "variant", "barcode", "delta")
      ON CONFLICT ("tenant_id", "count_id", "entry_key") DO NOTHING
      RETURNING "entry_key"
    `;
    return new Set(rows.map((row) => row.entry_key));
  }

  /** Creates the line of an item the first time it is counted (expected = balance now), then adds the new units. */
  private async applyToLines(tx: Tx, tenantId: string, header: Header, applied: Planned[]) {
    const net = new Map<string, Prisma.Decimal>();
    for (const item of applied) net.set(item.variant!.id, (net.get(item.variant!.id) ?? ZERO).plus(item.delta!));
    const ids = [...net.keys()].sort();
    if (!ids.length) return;
    await tx.$executeRaw`
      INSERT INTO "StockCountLine" ("id", "tenant_id", "count_id", "variant_id", "expected_qty")
      SELECT gen_random_uuid(), ${tenantId}::uuid, ${header.id}::uuid, u."variant_id", COALESCE(s."qty_on_hand", 0)
      FROM unnest(${ids}::uuid[]) AS u("variant_id")
      LEFT JOIN "InventoryStock" s
        ON s."tenant_id" = ${tenantId}::uuid AND s."warehouse_id" = ${header.warehouse_id}::uuid AND s."variant_id" = u."variant_id"
      ON CONFLICT ("tenant_id", "count_id", "variant_id") DO NOTHING
    `;
    await tx.$executeRaw`
      UPDATE "StockCountLine" l
      SET "counted_qty" = l."counted_qty" + u."delta", "updated_at" = CURRENT_TIMESTAMP
      FROM unnest(${ids}::uuid[], ${ids.map((id) => net.get(id)!.toFixed(3))}::numeric[]) AS u("variant_id", "delta")
      WHERE l."tenant_id" = ${tenantId}::uuid AND l."count_id" = ${header.id}::uuid AND l."variant_id" = u."variant_id"
    `;
  }

  private async lineTotals(tx: Tx, tenantId: string, countId: string, variantIds: string[]) {
    if (!variantIds.length) return new Map<string, { expected: Prisma.Decimal; counted: Prisma.Decimal }>();
    const rows = await tx.$queryRaw<Array<{ variant_id: string; expected_qty: Prisma.Decimal; counted_qty: Prisma.Decimal }>>`
      SELECT "variant_id", "expected_qty", "counted_qty" FROM "StockCountLine"
      WHERE "tenant_id" = ${tenantId}::uuid AND "count_id" = ${countId}::uuid AND "variant_id" = ANY(${variantIds}::uuid[])
    `;
    return new Map(rows.map((row) => [row.variant_id, { expected: row.expected_qty, counted: row.counted_qty }]));
  }

  private present(
    item: Planned,
    inserted: Set<string>,
    totals: Map<string, { expected: Prisma.Decimal; counted: Prisma.Decimal }>,
    mine: Map<string, Prisma.Decimal>,
  ) {
    const base = { entry_id: item.entry.entry_id, barcode: item.barcode };
    const variant = item.variant
      ? { id: item.variant.id, sku: item.variant.sku, label: item.variant.label, name_ar: item.variant.name_ar, name_en: item.variant.name_en, precision: item.variant.precision }
      : null;
    const total = item.variant ? totals.get(item.variant.id) : undefined;
    const status = item.status === 'counted' && !inserted.has(item.entry.entry_id) ? 'duplicate' : item.status;
    const refusal = REFUSALS[status];
    return {
      ...base,
      status,
      ...(refusal ? refusal : {}),
      variant,
      pack_qty: item.packQty,
      added: status === 'counted' && item.delta ? quantityNumber(item.delta) : 0,
      counted_total: total ? quantityNumber(total.counted) : null,
      counted_by_me: item.variant ? quantityNumber(mine.get(item.variant.id) ?? ZERO) : null,
      expected_at_count: total ? quantityNumber(total.expected) : null,
    };
  }
}
