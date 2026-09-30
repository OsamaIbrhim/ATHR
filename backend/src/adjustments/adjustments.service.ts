import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StockAdjustmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess } from '../auth/branch-access';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { CONFLICT, domainError } from '../common/domain-error';
import { InventoryService } from '../inventory/inventory.service';
import { loadStockVariants } from '../inventory/inventory-variants';
import { commandFingerprint } from '../transfers/transfer-command';
import { validateAdjustmentLines, type ValidLine } from './adjustment-lines';
import { AdjustmentsReadService } from './adjustments.read.service';
import type { CancelAdjustmentDto, CreateAdjustmentDto, UpdateAdjustmentDto } from './dto/adjustment.dto';

type Tx = Prisma.TransactionClient;
type Header = { id: string; status: StockAdjustmentStatus; branch_id: string; warehouse_id: string; adjustment_number: string };

const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;

const notDraft = (status: string) =>
  domainError(CONFLICT, 'ADJUSTMENT_NOT_DRAFT', `Only a draft can be edited or approved (this one is ${status})`, 'لا يمكن تعديل التسوية أو اعتمادها إلا وهي مسودة.', { status });

/**
 * The adjustment document: draft -> approved -> posted (or cancelled). Who may
 * do which step is decided by the controller's permission keys; every step is
 * one guarded UPDATE (`WHERE status = <expected>`), so two people acting at once
 * cannot both win. Posting is one engine command.
 */
@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly reads: AdjustmentsReadService,
  ) {}

  async create(context: TenantContext, dto: CreateAdjustmentDto, actor: AuthenticatedUser) {
    assertBranchAccess(actor, dto.branch_id);
    const fingerprint = commandFingerprint({
      branch_id: dto.branch_id,
      note: dto.note?.trim() || null,
      lines: [...dto.lines].sort((a, b) => a.variant_id.localeCompare(b.variant_id)),
    });
    if (dto.command_id) {
      const replay = await this.findByKey(context, dto.command_id, fingerprint);
      if (replay) return this.reads.get(context, replay, actor);
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branch_id, tenant_id: context.tenantId, is_active: true },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const warehouseId = await this.inventory.defaultWarehouseId(tx, context.tenantId, dto.branch_id);
        const variants = await loadStockVariants(tx, context.tenantId, dto.lines.map((line) => line.variant_id));
        const lines = validateAdjustmentLines(dto.lines, variants);
        const created = await tx.stockAdjustment.create({
          data: {
            tenant_id: context.tenantId,
            branch_id: dto.branch_id,
            warehouse_id: warehouseId,
            adjustment_number: await this.nextNumber(tx),
            note: dto.note?.trim() || null,
            idempotency_key: dto.command_id ?? null,
            command_fingerprint: fingerprint,
            created_by: actor.sub,
          },
          select: { id: true, adjustment_number: true },
        });
        await this.writeLines(tx, context.tenantId, created.id, lines);
        await this.audit(tx, context, actor, 'stock_adjustment.created', created.id, { number: created.adjustment_number, lines: lines.length });
        return created.id;
      }, TX_OPTIONS);
      return this.reads.get(context, id, actor);
    } catch (error) {
      // Two requests with one key raced: the unique key let one in; answer with its document.
      if (dto.command_id && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findByKey(context, dto.command_id, fingerprint);
        if (replay) return this.reads.get(context, replay, actor);
      }
      throw error;
    }
  }

  /** Replaces the note and every line of a draft. */
  async update(context: TenantContext, id: string, dto: UpdateAdjustmentDto, actor: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const header = await this.lock(tx, context, id);
      assertBranchAccess(actor, header.branch_id);
      if (header.status !== 'draft') throw notDraft(header.status);
      const variants = await loadStockVariants(tx, context.tenantId, dto.lines.map((line) => line.variant_id));
      const lines = validateAdjustmentLines(dto.lines, variants);
      await tx.stockAdjustmentItem.deleteMany({ where: { tenant_id: context.tenantId, adjustment_id: id } });
      await this.writeLines(tx, context.tenantId, id, lines);
      await tx.stockAdjustment.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'draft' },
        data: { note: dto.note?.trim() || null, updated_at: new Date() },
      });
      await this.audit(tx, context, actor, 'stock_adjustment.updated', id, { number: header.adjustment_number, lines: lines.length });
    }, TX_OPTIONS);
    return this.reads.get(context, id, actor);
  }

  async approve(context: TenantContext, id: string, actor: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const header = await this.lock(tx, context, id);
      assertBranchAccess(actor, header.branch_id);
      if (header.status === 'approved') return; // a retry of the same click
      if (header.status !== 'draft') throw notDraft(header.status);
      await tx.stockAdjustment.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'draft' },
        data: { status: 'approved', approved_by: actor.sub, approved_at: new Date(), updated_at: new Date() },
      });
      await this.audit(tx, context, actor, 'stock_adjustment.approved', id, { number: header.adjustment_number });
    }, TX_OPTIONS);
    return this.reads.get(context, id, actor);
  }

  /** The one engine command of the document; the lines are stamped with what they were valued at. */
  async post(context: TenantContext, id: string, actor: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const header = await this.lock(tx, context, id);
      assertBranchAccess(actor, header.branch_id);
      if (header.status === 'posted') return; // a retry: the document is already applied
      if (header.status !== 'approved') {
        throw domainError(CONFLICT, 'ADJUSTMENT_NOT_APPROVED', `Only an approved adjustment can be posted (this one is ${header.status})`, 'لا يمكن ترحيل التسوية إلا بعد اعتمادها.', { status: header.status });
      }
      const items = await tx.stockAdjustmentItem.findMany({
        where: { tenant_id: context.tenantId, adjustment_id: id },
        select: { id: true, variant_id: true, qty_delta: true, reason_code: true },
        orderBy: { variant_id: 'asc' },
      });
      const after = await this.inventory.apply(tx, {
        tenantId: context.tenantId,
        warehouseId: header.warehouse_id,
        occurredAt: new Date(),
        actorId: actor.sub,
        type: 'adjustment',
        costType: 'adjustment',
        reference: { type: 'StockAdjustment', id },
        idempotencyKey: `adjustment:${id}`,
        allowNegative: false,
        metadata: { adjustment_number: header.adjustment_number },
        lines: items.map((item) => ({
          variantId: item.variant_id,
          qtyDelta: item.qty_delta,
          referenceLineId: item.id,
          metadata: { reason_code: item.reason_code },
        })),
      });
      await this.stampItems(tx, context.tenantId, items, after);
      const posted = await tx.stockAdjustment.updateMany({
        where: { id, tenant_id: context.tenantId, status: 'approved' },
        data: { status: 'posted', posted_by: actor.sub, posted_at: new Date(), updated_at: new Date() },
      });
      if (posted.count !== 1) throw notDraft('changed');
      await this.audit(tx, context, actor, 'stock_adjustment.posted', id, { number: header.adjustment_number, lines: items.length });
    }, TX_OPTIONS);
    return this.reads.get(context, id, actor);
  }

  /** Cancels a draft or an approved document; nothing in stock changes. */
  async cancel(context: TenantContext, id: string, dto: CancelAdjustmentDto, actor: AuthenticatedUser) {
    if (!actor.permissions.has('inventory.adjustment.request') && !actor.permissions.has('inventory.adjustment.approve')) {
      throw new AthrDomainError('PERMISSION_DENIED', 'Cancelling an adjustment needs inventory.adjustment.request or inventory.adjustment.approve.');
    }
    await this.prisma.$transaction(async (tx) => {
      const header = await this.lock(tx, context, id);
      assertBranchAccess(actor, header.branch_id);
      if (header.status === 'cancelled') return;
      if (header.status === 'posted') {
        throw domainError(CONFLICT, 'ADJUSTMENT_ALREADY_POSTED', 'A posted adjustment cannot be cancelled; post a new adjustment to correct it', 'التسوية مرحّلة ولا يمكن إلغاؤها. صحّحها بتسوية جديدة.');
      }
      await tx.stockAdjustment.updateMany({
        where: { id, tenant_id: context.tenantId, status: { in: ['draft', 'approved'] } },
        data: {
          status: 'cancelled',
          cancelled_by: actor.sub,
          cancelled_at: new Date(),
          cancellation_reason: dto.reason?.trim() || null,
          updated_at: new Date(),
        },
      });
      await this.audit(tx, context, actor, 'stock_adjustment.cancelled', id, { number: header.adjustment_number, reason: dto.reason ?? null });
    }, TX_OPTIONS);
    return this.reads.get(context, id, actor);
  }

  // --- internals --------------------------------------------------------------

  /** The header row, locked for the rest of the transaction. */
  private async lock(tx: Tx, context: TenantContext, id: string): Promise<Header> {
    const [header] = await tx.$queryRaw<Header[]>`
      SELECT "id", "status"::text AS "status", "branch_id", "warehouse_id", "adjustment_number"
      FROM "StockAdjustment"
      WHERE "id" = ${id}::uuid AND "tenant_id" = ${context.tenantId}::uuid
      FOR UPDATE
    `;
    if (!header) throw new NotFoundException('Stock adjustment not found');
    return header;
  }

  private writeLines(tx: Tx, tenantId: string, adjustmentId: string, lines: ValidLine[]) {
    return tx.stockAdjustmentItem.createMany({
      data: lines.map((line) => ({ tenant_id: tenantId, adjustment_id: adjustmentId, ...line })),
    });
  }

  /** Records, per line, the quantities and the value the engine applied (value = change x average cost). */
  private async stampItems(
    tx: Tx,
    tenantId: string,
    items: Array<{ id: string; variant_id: string }>,
    after: Array<{ variantId: string; qtyBefore: Prisma.Decimal; qtyAfter: Prisma.Decimal; avgCostBefore: Prisma.Decimal }>,
  ) {
    const byVariant = new Map(after.map((stock) => [stock.variantId, stock]));
    const rows = items.flatMap((item) => {
      const stock = byVariant.get(item.variant_id);
      return stock ? [{ id: item.id, stock }] : [];
    });
    if (!rows.length) return;
    await tx.$executeRaw`
      UPDATE "StockAdjustmentItem" item
      SET "qty_before" = u."before", "qty_after" = u."after", "unit_cost" = u."cost",
          "value" = ROUND((u."after" - u."before") * u."cost", 2)
      FROM unnest(
        ${rows.map((row) => row.id)}::uuid[],
        ${rows.map((row) => row.stock.qtyBefore.toFixed(3))}::numeric[],
        ${rows.map((row) => row.stock.qtyAfter.toFixed(3))}::numeric[],
        ${rows.map((row) => row.stock.avgCostBefore.toFixed(4))}::numeric[]
      ) AS u("id", "before", "after", "cost")
      WHERE item."tenant_id" = ${tenantId}::uuid AND item."id" = u."id"
    `;
  }

  private async nextNumber(tx: Tx): Promise<string> {
    const [row] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('"StockAdjustmentNumberSequence"') AS value`;
    return `ADJ-${row.value.toString().padStart(6, '0')}`;
  }

  /** The id of this key's document; 409 when the key was used for a different payload. */
  private async findByKey(context: TenantContext, key: string, fingerprint: string): Promise<string | null> {
    const existing = await this.prisma.stockAdjustment.findFirst({
      where: { tenant_id: context.tenantId, idempotency_key: key },
      select: { id: true, command_fingerprint: true },
    });
    if (!existing) return null;
    if (existing.command_fingerprint !== fingerprint) {
      throw domainError(CONFLICT, 'IDEMPOTENCY_KEY_REUSED', 'This command id was already used for a different adjustment', 'رقم العملية هذا استُخدم بالفعل لتسوية مختلفة.');
    }
    return existing.id;
  }

  private audit(tx: Tx, context: TenantContext, actor: AuthenticatedUser, action: string, id: string, meta: Prisma.InputJsonValue) {
    return tx.auditLog.create({
      data: { tenant_id: context.tenantId, user_id: actor.sub, action, entity: 'StockAdjustment', entity_id: id, meta },
    });
  }
}
