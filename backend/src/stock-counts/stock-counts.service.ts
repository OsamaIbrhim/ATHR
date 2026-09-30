import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { CONFLICT, domainError, NOT_FOUND, UNPROCESSABLE } from '../common/domain-error';
import { quantityNumber } from '../common/quantity';
import { InventoryService } from '../inventory/inventory.service';
import { commandFingerprint } from '../transfers/transfer-command';
import { countScopeItems, scopeKey, scopePredicate, scopesOverlap, type CountScope } from './stock-count-scope';
import { StockCountsReadService } from './stock-counts.read.service';
import type { CancelCountDto, PostCountDto, StartCountDto } from './dto/stock-count.dto';

type Tx = Prisma.TransactionClient;
type Header = CountScope & {
  id: string;
  status: string;
  name: string;
  count_number: string;
  branch_id: string;
  warehouse_id: string;
};
type LineRow = { id: string; variant_id: string; expected_qty: Prisma.Decimal; counted_qty: Prisma.Decimal; zeroed: boolean };

const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;
const ZERO = new Prisma.Decimal(0);

const closed = (status: string) =>
  domainError(CONFLICT, 'STOCK_COUNT_CLOSED', `This count is ${status} and no longer changes`, 'هذا الجرد أُغلق ولم يعد يقبل التغيير.', { status });

/**
 * Stock count sessions: start, cancel, and post. Scanning lives in
 * StockCountScansService, reading in StockCountsReadService.
 *
 * Posting applies `counted - expected_at_count` of every line as ONE engine
 * command (type stock_count): the expected quantity of an item is what was on
 * hand when it was first counted, so sales made before or after it was counted
 * are preserved. An item nobody counted changes only by an explicit choice.
 */
@Injectable()
export class StockCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly reads: StockCountsReadService,
  ) {}

  async start(context: TenantContext, dto: StartCountDto, actor: AuthenticatedUser) {
    assertBranchAccess(actor, dto.branch_id);
    const scope: CountScope = {
      scope_type: dto.scope.type,
      category_id: dto.scope.type === 'category' ? dto.scope.id! : null,
      product_type_id: dto.scope.type === 'product_type' ? dto.scope.id! : null,
    };
    const fingerprint = commandFingerprint({ branch_id: dto.branch_id, scope, name: dto.name?.trim() || null });
    if (dto.command_id) {
      const replay = await this.findByKey(context, dto.command_id, fingerprint);
      if (replay) return this.reads.get(context, replay, actor);
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branch_id, tenant_id: context.tenantId, is_active: true },
      select: { id: true, name_ar: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    await this.assertScopeExists(context, scope);

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const warehouseId = await this.inventory.defaultWarehouseId(tx, context.tenantId, dto.branch_id);
        // One start at a time per warehouse, so two clicks cannot both pass the overlap check.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`stock-count:${warehouseId}`}, 0))`;
        await this.assertNoOverlap(tx, context.tenantId, warehouseId, scope);
        if ((await countScopeItems(tx, context.tenantId, scope)) === 0) {
          throw domainError(UNPROCESSABLE, 'STOCK_COUNT_EMPTY_SCOPE', 'There are no items to count in this scope', 'لا توجد أصناف في هذا النطاق.');
        }
        const created = await tx.stockCount.create({
          data: {
            tenant_id: context.tenantId,
            branch_id: dto.branch_id,
            warehouse_id: warehouseId,
            count_number: await this.nextNumber(tx),
            name: dto.name?.trim() || `جرد ${branch.name_ar} ${new Date().toISOString().slice(0, 10)}`,
            ...scope,
            scope_key: scopeKey(scope),
            idempotency_key: dto.command_id ?? null,
            started_by: actor.sub,
          },
          select: { id: true, count_number: true },
        });
        await this.audit(tx, context, actor, 'stock_count.started', created.id, { number: created.count_number, scope });
        return created.id;
      }, TX_OPTIONS);
      return this.reads.get(context, id, actor);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = dto.command_id ? await this.findByKey(context, dto.command_id, fingerprint) : null;
        if (replay) return this.reads.get(context, replay, actor);
        throw await this.alreadyOpen(context.tenantId, dto.branch_id);
      }
      throw error;
    }
  }

  async cancel(context: TenantContext, id: string, dto: CancelCountDto, actor: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const header = await this.lock(tx, context, id);
      assertBranchAccess(actor, header.branch_id);
      if (header.status === 'cancelled') return;
      if (header.status !== 'open') throw closed(header.status);
      await tx.stockCount.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'open' },
        data: { status: 'cancelled', cancelled_by: actor.sub, cancelled_at: new Date(), updated_at: new Date() },
      });
      await this.audit(tx, context, actor, 'stock_count.cancelled', id, { number: header.count_number, reason: dto.reason ?? null });
    }, TX_OPTIONS);
    return this.reads.get(context, id, actor);
  }

  async post(context: TenantContext, id: string, dto: PostCountDto, actor: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const header = await this.lock(tx, context, id);
      assertBranchAccess(actor, header.branch_id);
      if (header.status === 'posted') return; // a retry: already applied
      if (header.status !== 'open') throw closed(header.status);

      const lines = await tx.$queryRaw<LineRow[]>`
        SELECT "id", "variant_id", "expected_qty", "counted_qty", "zeroed"
        FROM "StockCountLine"
        WHERE "tenant_id" = ${context.tenantId}::uuid AND "count_id" = ${id}::uuid
      `;
      const uncounted = await this.uncountedWithBalance(tx, context.tenantId, header);
      if (uncounted.length && !dto.uncounted) {
        throw domainError(
          UNPROCESSABLE,
          'STOCK_COUNT_UNCOUNTED_DECISION_REQUIRED',
          'Choose what happens to the items nobody counted: zero them or leave them',
          'اختر ما يحدث للأصناف التي لم تُعدّ: تصفير رصيدها أو تركها كما هي.',
          { uncounted_items: uncounted.length },
        );
      }
      const zeroed = this.zeroedSet(uncounted, dto);
      const added = zeroed.length ? await this.addZeroedLines(tx, context.tenantId, id, zeroed) : [];
      const all = [...lines, ...added];

      const changes = all
        .map((line) => ({ line, delta: line.zeroed ? line.expected_qty.negated() : line.counted_qty.minus(line.expected_qty) }))
        .filter((change) => !change.delta.isZero());
      await this.assertNoNegativeResult(tx, context.tenantId, header, changes);
      const after = changes.length
        ? await this.inventory.apply(tx, {
            tenantId: context.tenantId,
            warehouseId: header.warehouse_id,
            occurredAt: new Date(),
            actorId: actor.sub,
            type: 'stock_count',
            costType: 'adjustment',
            reference: { type: 'StockCount', id },
            idempotencyKey: `stock-count:${id}`,
            allowNegative: false,
            metadata: { count_number: header.count_number },
            lines: changes.map(({ line, delta }) => ({
              variantId: line.variant_id,
              qtyDelta: delta,
              referenceLineId: line.id,
              metadata: { expected_at_count: quantityNumber(line.expected_qty), counted: quantityNumber(line.counted_qty) },
            })),
          })
        : [];
      await this.stampLines(tx, context.tenantId, all, changes, after);
      await tx.stockCount.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'open' },
        data: { status: 'posted', posted_by: actor.sub, posted_at: new Date(), updated_at: new Date(), uncounted_choice: dto.uncounted ?? null },
      });
      await this.audit(tx, context, actor, 'stock_count.posted', id, {
        number: header.count_number,
        lines_changed: changes.length,
        uncounted_choice: dto.uncounted ?? null,
        uncounted_zeroed: zeroed.length,
      });
    }, TX_OPTIONS);
    return this.reads.get(context, id, actor);
  }

  // --- internals --------------------------------------------------------------

  private async lock(tx: Tx, context: TenantContext, id: string): Promise<Header> {
    const [header] = await tx.$queryRaw<Header[]>`
      SELECT "id", "status"::text AS "status", "name", "count_number", "branch_id", "warehouse_id",
             "scope_type"::text AS "scope_type", "category_id", "product_type_id"
      FROM "StockCount"
      WHERE "id" = ${id}::uuid AND "tenant_id" = ${context.tenantId}::uuid
      FOR UPDATE
    `;
    if (!header) throw new NotFoundException('Stock count not found');
    return header;
  }

  private async assertScopeExists(context: TenantContext, scope: CountScope) {
    const found =
      scope.scope_type === 'category'
        ? await this.prisma.category.findFirst({ where: { id: scope.category_id!, tenant_id: context.tenantId }, select: { id: true } })
        : scope.scope_type === 'product_type'
          ? await this.prisma.productType.findFirst({ where: { id: scope.product_type_id!, tenant_id: context.tenantId }, select: { id: true } })
          : true;
    if (!found) {
      throw domainError(NOT_FOUND, 'STOCK_COUNT_SCOPE_NOT_FOUND', 'The category or product type was not found', 'التصنيف أو نوع المنتج غير موجود.');
    }
  }

  private async assertNoOverlap(tx: Tx, tenantId: string, warehouseId: string, scope: CountScope) {
    const open = await tx.$queryRaw<Array<CountScope & { id: string; name: string; count_number: string }>>`
      SELECT "id", "name", "count_number", "scope_type"::text AS "scope_type", "category_id", "product_type_id"
      FROM "StockCount"
      WHERE "tenant_id" = ${tenantId}::uuid AND "warehouse_id" = ${warehouseId}::uuid AND "status" = 'open'
    `;
    const clash = open.find((other) => scopesOverlap(scope, other));
    if (clash) throw this.alreadyOpenError(clash);
  }

  private alreadyOpenError(clash: { id: string; name: string; count_number: string }) {
    return domainError(
      CONFLICT,
      'STOCK_COUNT_ALREADY_OPEN',
      `A count is already open for this branch: ${clash.name}`,
      `يوجد جرد جارٍ لهذا الفرع: ${clash.name}.`,
      { count_id: clash.id, name: clash.name, count_number: clash.count_number },
    );
  }

  /** The open count that won the one-open-per-scope index (after a lost race). */
  private async alreadyOpen(tenantId: string, branchId: string) {
    const existing = await this.prisma.stockCount.findFirst({
      where: { tenant_id: tenantId, branch_id: branchId, status: 'open' },
      orderBy: { created_at: 'desc' },
      select: { id: true, name: true, count_number: true },
    });
    return existing
      ? this.alreadyOpenError(existing)
      : domainError(CONFLICT, 'STOCK_COUNT_ALREADY_OPEN', 'A count is already open for this branch', 'يوجد جرد جارٍ لهذا الفرع.');
  }

  /** In-scope items nobody counted that hold a non-zero balance (the only ones posting can change). */
  private uncountedWithBalance(tx: Tx, tenantId: string, scope: CountScope & { warehouse_id: string; id: string }) {
    return tx.$queryRaw<Array<{ variant_id: string; on_hand: Prisma.Decimal }>>`
      SELECT v."id" AS "variant_id", s."qty_on_hand" AS "on_hand"
      FROM "ProductVariant" v
      JOIN "Product" p ON p."tenant_id" = v."tenant_id" AND p."id" = v."product_id"
      JOIN "InventoryStock" s
        ON s."tenant_id" = v."tenant_id" AND s."warehouse_id" = ${scope.warehouse_id}::uuid AND s."variant_id" = v."id"
      WHERE v."tenant_id" = ${tenantId}::uuid
        AND v."is_active" AND p."is_active" AND v."item_type" = 'stocked' AND v."tracking" = 'none'
        AND ${scopePredicate(scope)}
        AND s."qty_on_hand" <> 0
        AND NOT EXISTS (
          SELECT 1 FROM "StockCountLine" l
          WHERE l."tenant_id" = v."tenant_id" AND l."count_id" = ${scope.id}::uuid AND l."variant_id" = v."id"
        )
    `;
  }

  /** The uncounted items to count as zero: all but `keep` under `zero`, only `zero_variant_ids` under `ignore`. */
  private zeroedSet(uncounted: Array<{ variant_id: string }>, dto: PostCountDto): string[] {
    const keep = new Set(dto.keep_variant_ids ?? []);
    const pick = new Set(dto.zero_variant_ids ?? []);
    return uncounted
      .map((item) => item.variant_id)
      .filter((variantId) => (dto.uncounted === 'zero' ? !keep.has(variantId) : pick.has(variantId)));
  }

  /** "Counted as zero" lines: expected = the balance right now, counted = 0. */
  private addZeroedLines(tx: Tx, tenantId: string, countId: string, variantIds: string[]) {
    return tx.$queryRaw<LineRow[]>`
      INSERT INTO "StockCountLine" ("id", "tenant_id", "count_id", "variant_id", "expected_qty", "counted_qty", "zeroed")
      SELECT gen_random_uuid(), ${tenantId}::uuid, ${countId}::uuid, s."variant_id", s."qty_on_hand", 0, TRUE
      FROM "InventoryStock" s
      JOIN "StockCount" c ON c."tenant_id" = s."tenant_id" AND c."id" = ${countId}::uuid AND c."warehouse_id" = s."warehouse_id"
      WHERE s."tenant_id" = ${tenantId}::uuid AND s."variant_id" = ANY(${variantIds}::uuid[])
      RETURNING "id", "variant_id", "expected_qty", "counted_qty", "zeroed"
    `;
  }

  /** Refuses, naming the items, a posting that would push a balance below what is reserved. */
  private async assertNoNegativeResult(
    tx: Tx,
    tenantId: string,
    header: Header,
    changes: Array<{ line: LineRow; delta: Prisma.Decimal }>,
  ) {
    const removals = changes.filter((change) => change.delta.isNegative());
    if (!removals.length) return;
    const rows = await tx.$queryRaw<Array<{ variant_id: string; qty_on_hand: Prisma.Decimal; qty_reserved: Prisma.Decimal }>>`
      SELECT "variant_id", "qty_on_hand", "qty_reserved" FROM "InventoryStock"
      WHERE "tenant_id" = ${tenantId}::uuid AND "warehouse_id" = ${header.warehouse_id}::uuid
        AND "variant_id" = ANY(${removals.map((change) => change.line.variant_id)}::uuid[])
    `;
    const byVariant = new Map(rows.map((row) => [row.variant_id, row]));
    const offenders = removals.filter(({ line, delta }) => {
      const stock = byVariant.get(line.variant_id);
      return !stock || stock.qty_on_hand.plus(delta).minus(stock.qty_reserved).isNegative();
    });
    if (offenders.length) {
      throw domainError(
        CONFLICT,
        'STOCK_COUNT_WOULD_GO_NEGATIVE',
        'Posting would take some items below zero because they sold after being counted; recount them or adjust them first',
        'الترحيل سيجعل رصيد بعض الأصناف بالسالب لأنها بيعت بعد عدّها. أعد عدّها أو اعمل لها تسوية أولًا.',
        {
          items: offenders.map(({ line, delta }) => ({
            variant_id: line.variant_id,
            variance: quantityNumber(delta),
            on_hand: quantityNumber(byVariant.get(line.variant_id)?.qty_on_hand ?? ZERO),
          })),
        },
      );
    }
  }

  /** Records on each line the change applied and the average cost it was valued at. */
  private async stampLines(
    tx: Tx,
    tenantId: string,
    lines: LineRow[],
    changes: Array<{ line: LineRow; delta: Prisma.Decimal }>,
    after: Array<{ variantId: string; avgCostBefore: Prisma.Decimal }>,
  ) {
    if (!lines.length) return;
    const delta = new Map(changes.map((change) => [change.line.id, change.delta]));
    const cost = new Map(after.map((stock) => [stock.variantId, stock.avgCostBefore]));
    await tx.$executeRaw`
      UPDATE "StockCountLine" l
      SET "applied_delta" = u."delta", "unit_cost" = NULLIF(u."cost", '')::numeric, "updated_at" = CURRENT_TIMESTAMP
      FROM unnest(
        ${lines.map((line) => line.id)}::uuid[],
        ${lines.map((line) => (delta.get(line.id) ?? ZERO).toFixed(3))}::numeric[],
        ${lines.map((line) => cost.get(line.variant_id)?.toFixed(4) ?? '')}::text[]
      ) AS u("id", "delta", "cost")
      WHERE l."tenant_id" = ${tenantId}::uuid AND l."id" = u."id"
    `;
  }

  private async nextNumber(tx: Tx): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('"StockCountNumberSequence"') AS value`;
    return `CNT-${row.value.toString().padStart(6, '0')}`;
  }

  private async findByKey(context: TenantContext, key: string, fingerprint: string): Promise<string | null> {
    const existing = await this.prisma.stockCount.findFirst({
      where: { tenant_id: context.tenantId, idempotency_key: key },
      select: { id: true, name: true, branch_id: true, scope_type: true, category_id: true, product_type_id: true },
    });
    if (!existing) return null;
    const same =
      commandFingerprint({
        branch_id: existing.branch_id,
        scope: { scope_type: existing.scope_type, category_id: existing.category_id, product_type_id: existing.product_type_id },
        name: existing.name,
      }) === fingerprint;
    // A defaulted name is stored, so compare the scope and branch only when no name was given.
    const sameScope = commandFingerprint({
      branch_id: existing.branch_id,
      scope: { scope_type: existing.scope_type, category_id: existing.category_id, product_type_id: existing.product_type_id },
      name: null,
    }) === fingerprint;
    if (!same && !sameScope) {
      throw domainError(CONFLICT, 'IDEMPOTENCY_KEY_REUSED', 'This command id was already used for a different count', 'رقم العملية هذا استُخدم بالفعل لجرد مختلف.');
    }
    return existing.id;
  }

  private audit(tx: Tx, context: TenantContext, actor: AuthenticatedUser, action: string, id: string, meta: Prisma.InputJsonValue) {
    return tx.auditLog.create({
      data: { tenant_id: context.tenantId, user_id: actor.sub, action, entity: 'StockCount', entity_id: id, meta },
    });
  }
}
