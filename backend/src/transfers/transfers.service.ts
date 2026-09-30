import { FIRST_PAGE, pageArgs, pageOf, type PageQuery } from '../common/pagination';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Transfer } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext, TenantScope } from '../identity/tenant-context.type';
import {
  CancelTransferDto,
  CreateTransferDto,
  ReceiveTransferDto,
  TransferCommandDto,
} from './dto/transfer.dto';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { assertBranchAccess, canAccessAllBranches, hasBranchAccess } from '../auth/branch-access';
import {
  commandFingerprint,
  resolveCommandId,
  TransferCommandType,
} from './transfer-command';
import { InventoryService } from '../inventory/inventory.service';
import {
  assertQuantityPrecision,
  quantity,
  variantQuantityPrecision,
} from '../common/quantity';

type TransferCommandRow = {
  command_fingerprint: string;
  result_status: string;
};

type TransferStateRow = {
  status: string;
  transfer_number: string;
  from_branch_id: string;
  to_branch_id: string;
  command_fingerprint: string | null;
};

type TransferItemState = {
  id: string;
  variant_id: string;
  qty: Prisma.Decimal;
  shipped_qty: Prisma.Decimal;
  received_qty: Prisma.Decimal;
  damaged_qty: Prisma.Decimal;
  missing_qty: Prisma.Decimal;
  unit_cost: Prisma.Decimal | null;
};

/** One row of the append-only in-transit ledger. */
type TransitRow = {
  itemId: string;
  variantId: string;
  type: 'shipped' | 'received' | 'damaged' | 'missing';
  delta: Prisma.Decimal;
  after: Prisma.Decimal;
  key: string;
};

const ZERO = new Prisma.Decimal(0);

/**
 * Transfer line columns exposed to API callers. `unit_cost` (the source average
 * cost carried to the destination) is deliberately absent: like every cost it
 * is not something a transfer reader may see.
 */
const ITEM_COLUMNS = {
  id: true,
  tenant_id: true,
  transfer_id: true,
  variant_id: true,
  qty: true,
  shipped_qty: true,
  received_qty: true,
  damaged_qty: true,
  missing_qty: true,
} as const;

@Injectable()
export class TransfersService {
  constructor(
    private prisma: PrismaService,
    private inventory: InventoryService,
  ) {}

  async list(context: TenantContext, branch_id?: string, paging: PageQuery = FIRST_PAGE) {
    const where: Prisma.TransferWhereInput = {
      tenant_id: context.tenantId,
      ...(branch_id
        ? { OR: [{ from_branch_id: branch_id }, { to_branch_id: branch_id }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.transfer.findMany({
        where,
        include: { from_branch: true, to_branch: true, items: { select: ITEM_COLUMNS } },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        ...pageArgs(paging),
      }),
      this.prisma.transfer.count({ where }),
    ]);
    return pageOf(items, total, paging);
  }

  async get(context: TenantContext, id: string, actor: AuthenticatedUser) {
    const transfer = await this.prisma.transfer.findFirst({
      where: { id, tenant_id: context.tenantId },
      include: {
        from_branch: true,
        to_branch: true,
        items: { select: { ...ITEM_COLUMNS, variant: { include: { product: true } } } },
      },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    this.assertTransferVisibility(actor, transfer);
    const [state] = await this.prisma.$queryRaw<TransferStateRow[]>`
      SELECT "status"::text, "transfer_number", "from_branch_id", "to_branch_id", "command_fingerprint"
      FROM "Transfer"
      WHERE "id" = ${id}::uuid
        AND "tenant_id" = ${context.tenantId}::uuid
    `;
    const items = await this.prisma.$queryRaw<TransferItemState[]>`
      SELECT
        "id", "variant_id", "qty", "shipped_qty", "received_qty",
        "damaged_qty", "missing_qty"
      FROM "TransferItem"
      WHERE "transfer_id" = ${id}::uuid
        AND "tenant_id" = ${context.tenantId}::uuid
      ORDER BY "id"
    `;
    return {
      ...transfer,
      ...state,
      items: transfer.items.map((item) => ({
        ...item,
        ...items.find((stateItem) => stateItem.id === item.id),
      })),
    };
  }

  async create(context: TenantContext, dto: CreateTransferDto, actor: AuthenticatedUser) {
    if (dto.from_branch_id === dto.to_branch_id) {
      throw new BadRequestException(
        'Source and destination branches must be different',
      );
    }
    assertBranchAccess(actor, dto.from_branch_id);

    const quantities = new Map<string, Prisma.Decimal>();
    for (const item of dto.items) {
      quantities.set(
        item.variant_id,
        (quantities.get(item.variant_id) ?? ZERO).plus(quantity(item.qty)),
      );
    }
    const items = [...quantities.entries()]
      .map(([variant_id, qty]) => ({ variant_id, qty }))
      .sort((left, right) => left.variant_id.localeCompare(right.variant_id));
    const commandId = resolveCommandId(dto.command_id);
    const fingerprint = commandFingerprint({
      from_branch_id: dto.from_branch_id,
      to_branch_id: dto.to_branch_id,
      items: items.map((item) => ({ ...item, qty: item.qty.toNumber() })),
    });

    return this.serializable(async (tx) => {
      await this.enableTransferCommand(tx);
      const [existing] = await tx.$queryRaw<
        Array<{ id: string; command_fingerprint: string | null }>
      >`
        SELECT "id", "command_fingerprint"
        FROM "Transfer"
        WHERE "idempotency_key" = ${commandId}
          AND "tenant_id" = ${context.tenantId}::uuid
        FOR UPDATE
      `;
      if (existing) {
        if (existing.command_fingerprint !== fingerprint) {
          throw new ConflictException(
            'Transfer command id belongs to a different payload',
          );
        }
        return this.loadTransfer(tx, context, existing.id);
      }

      const [branches, variants] = await Promise.all([
        // Both branches must belong to the caller's tenant. Without this a
        // transfer could be created with another tenant's branch as its
        // destination, moving stock straight across the boundary.
        tx.branch.count({
          where: {
            id: { in: [dto.from_branch_id, dto.to_branch_id] },
            tenant_id: context.tenantId,
            is_active: true,
          },
        }),
        tx.productVariant.findMany({
          where: {
            id: { in: items.map((item) => item.variant_id) },
            tenant_id: context.tenantId,
          },
          select: { id: true, sku: true, item_type: true, tracking: true, base_uom: { select: { precision: true } } },
        }),
      ]);
      if (branches !== 2) {
        throw new NotFoundException('One or more active branches were not found');
      }
      if (variants.length !== items.length) {
        throw new NotFoundException(
          'One or more product variants were not found',
        );
      }
      const variantById = new Map(variants.map((variant) => [variant.id, variant]));
      for (const item of items) {
        const variant = variantById.get(item.variant_id)!;
        if (variant.item_type !== 'stocked') {
          throw new BadRequestException(`Only stocked items can be transferred (${variant.sku})`);
        }
        // W2b-2 will move serials and batches with the goods; until then a transfer would lose them.
        if (variant.tracking === 'serial' || variant.tracking === 'batch') {
          throw new UnprocessableEntityException({
            code: 'TRACKED_TRANSFER_NOT_SUPPORTED',
            message: `Serial- and batch-tracked items cannot be transferred yet (${variant.sku})`,
            message_ar: 'لا يمكن تحويل الأصناف المتتبعة بالسيريال أو بالدفعات حاليًا.',
            variant_id: variant.id,
          });
        }
        assertQuantityPrecision(item.qty, variantQuantityPrecision(variant), variant.sku);
      }

      const id = randomUUID();
      const transferNumber = await this.nextTransferNumber(tx);
      await tx.$executeRaw`
        INSERT INTO "Transfer" (
          "id", "from_branch_id", "to_branch_id", "status",
          "transfer_number", "created_by", "idempotency_key",
          "command_fingerprint", "tenant_id", "created_at", "updated_at"
        ) VALUES (
          ${id}::uuid, ${dto.from_branch_id}::uuid, ${dto.to_branch_id}::uuid,
          'pending'::"TransferStatus", ${transferNumber}, ${actor.sub}::uuid,
          ${commandId}, ${fingerprint}, ${context.tenantId}::uuid,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      await tx.$executeRaw`
        INSERT INTO "TransferItem" (
          "id", "transfer_id", "variant_id", "qty",
          "shipped_qty", "received_qty", "damaged_qty", "missing_qty",
          "tenant_id"
        )
        SELECT gen_random_uuid(), ${id}::uuid, u."variant_id", u."qty", 0, 0, 0, 0, ${context.tenantId}::uuid
        FROM unnest(
          ${items.map((item) => item.variant_id)}::uuid[],
          ${items.map((item) => item.qty.toFixed(3))}::numeric[]
        ) AS u("variant_id", "qty")
      `;
      await this.audit(tx, context, actor.sub, 'transfer.created', id, {
        command_id: commandId,
        transfer_number: transferNumber,
      });
      return this.loadTransfer(tx, context, id);
    });
  }

  async ship(
    context: TenantContext,
    id: string,
    dto: TransferCommandDto,
    actor: AuthenticatedUser,
  ) {
    const commandId = resolveCommandId(dto.command_id);
    const fingerprint = commandFingerprint({ transfer_id: id, action: 'ship' });
    return this.serializable(async (tx) => {
      await this.enableTransferCommand(tx);
      const transfer = await this.lockTransfer(tx, context, id);
      assertBranchAccess(actor, transfer.from_branch_id);
      if (
        await this.replayCommand(tx, context, id, 'ship', commandId, fingerprint)
      ) {
        return this.loadTransfer(tx, context, id);
      }
      if (transfer.status !== 'pending') {
        throw new ConflictException('Only a pending transfer can be shipped');
      }

      const items = await this.lockItems(tx, context, id);
      const shippedAt = new Date();

      // Goods leave the source branch's default warehouse at its average
      // cost; the cost is kept on the line for the receiving warehouse.
      const after = await this.inventory.apply(tx, {
        tenantId: context.tenantId,
        warehouseId: await this.inventory.defaultWarehouseId(tx, context.tenantId, transfer.from_branch_id),
        occurredAt: shippedAt,
        actorId: actor.sub,
        type: 'transfer_out',
        reference: { type: 'Transfer', id },
        idempotencyKey: `transfer-out:${id}`,
        allowNegative: false,
        metadata: { transfer_number: transfer.transfer_number },
        lines: items.map((item) => ({
          variantId: item.variant_id,
          qtyDelta: item.qty.negated(),
          referenceLineId: item.id,
        })),
      });
      const avgCost = new Map(after.map((stock) => [stock.variantId, stock.avgCost]));
      await tx.$executeRaw`
        UPDATE "TransferItem" item
        SET "shipped_qty" = item."qty", "unit_cost" = u."unit_cost"
        FROM unnest(
          ${items.map((item) => item.id)}::uuid[],
          ${items.map((item) => (avgCost.get(item.variant_id) ?? ZERO).toFixed(4))}::numeric[]
        ) AS u("id", "unit_cost")
        WHERE item."id" = u."id"
      `;
      await tx.$executeRaw`
        UPDATE "Transfer"
        SET "status" = 'shipped'::"TransferStatus",
            "shipped_by" = ${actor.sub}::uuid,
            "shipped_at" = ${shippedAt.toISOString()}::timestamp,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}::uuid
      `;
      await this.insertTransitMovements(
        tx,
        context,
        id,
        shippedAt,
        actor.sub,
        transfer.transfer_number,
        items.map((item) => ({
          itemId: item.id,
          variantId: item.variant_id,
          type: 'shipped' as const,
          delta: item.qty,
          after: item.qty,
          key: `transit-shipped:${item.id}:${item.qty.toFixed(3)}`,
        })),
      );
      await this.recordCommand(
        tx,
        context,
        id,
        'ship',
        commandId,
        fingerprint,
        'shipped',
        actor.sub,
      );
      await this.audit(tx, context, actor.sub, 'transfer.shipped', id, {
        command_id: commandId,
      });
      return this.loadTransfer(tx, context, id);
    });
  }

  async receive(
    context: TenantContext,
    id: string,
    dto: ReceiveTransferDto,
    actor: AuthenticatedUser,
  ) {
    const normalizedItems = [...(dto.items || [])]
      .map((item) => ({
        transfer_item_id: item.transfer_item_id,
        received_qty: item.received_qty,
        damaged_qty: item.damaged_qty || 0,
        missing_qty: item.missing_qty || 0,
      }))
      .sort((left, right) =>
        left.transfer_item_id.localeCompare(right.transfer_item_id),
      );
    const commandId = resolveCommandId(dto.command_id);
    const fingerprint = commandFingerprint({
      transfer_id: id,
      action: 'receive',
      items: normalizedItems,
    });

    return this.serializable(async (tx) => {
      await this.enableTransferCommand(tx);
      const transfer = await this.lockTransfer(tx, context, id);
      assertBranchAccess(actor, transfer.to_branch_id);
      if (
        await this.replayCommand(tx, context, id, 'receive', commandId, fingerprint)
      ) {
        return this.loadTransfer(tx, context, id);
      }
      if (!['shipped', 'partially_received'].includes(transfer.status)) {
        throw new ConflictException(
          'Only a shipped transfer can be received',
        );
      }

      const items = await this.lockItems(tx, context, id);
      const outstandingOf = (item: TransferItemState) =>
        item.shipped_qty.minus(item.received_qty).minus(item.damaged_qty).minus(item.missing_qty);
      const requested = normalizedItems.length
        ? normalizedItems.map((item) => ({
            transfer_item_id: item.transfer_item_id,
            received_qty: quantity(item.received_qty),
            damaged_qty: quantity(item.damaged_qty),
            missing_qty: quantity(item.missing_qty),
          }))
        : items.map((item) => ({
            transfer_item_id: item.id,
            received_qty: outstandingOf(item),
            damaged_qty: ZERO,
            missing_qty: ZERO,
          }));
      const requestIds = new Set(requested.map((item) => item.transfer_item_id));
      if (requestIds.size !== requested.length) {
        throw new BadRequestException('Duplicate transfer item in receipt');
      }

      const itemById = new Map(items.map((item) => [item.id, item]));
      const transit: TransitRow[] = [];
      const stockLines: Array<{ item: TransferItemState; qty: Prisma.Decimal }> = [];
      let remaining = items.reduce((sum, item) => sum.plus(outstandingOf(item)), ZERO);
      for (const receipt of requested) {
        const item = itemById.get(receipt.transfer_item_id);
        if (!item) {
          throw new BadRequestException(
            `Transfer item ${receipt.transfer_item_id} does not belong to this transfer`,
          );
        }
        const resolved = receipt.received_qty.plus(receipt.damaged_qty).plus(receipt.missing_qty);
        let cursor = outstandingOf(item);
        if (resolved.lte(0) || resolved.gt(cursor)) {
          throw new BadRequestException(
            `Invalid receipt quantities for transfer item ${item.id}`,
          );
        }
        remaining = remaining.minus(resolved);
        if (receipt.received_qty.gt(0)) stockLines.push({ item, qty: receipt.received_qty });

        // The in-transit ledger, in the order goods are resolved.
        const cumulative = {
          received: item.received_qty,
          damaged: item.damaged_qty,
          missing: item.missing_qty,
        };
        for (const type of ['received', 'damaged', 'missing'] as const) {
          const qty = receipt[`${type}_qty`];
          if (qty.lte(0)) continue;
          cursor = cursor.minus(qty);
          cumulative[type] = cumulative[type].plus(qty);
          transit.push({
            itemId: item.id,
            variantId: item.variant_id,
            type,
            delta: qty.negated(),
            after: cursor,
            key: `transit-${type}:${item.id}:${cumulative[type].toFixed(3)}`,
          });
        }
      }

      // Only received units reach the destination warehouse, at the cost
      // recorded when they were shipped.
      const receivedAt = new Date();
      await this.inventory.apply(tx, {
        tenantId: context.tenantId,
        warehouseId: await this.inventory.defaultWarehouseId(tx, context.tenantId, transfer.to_branch_id),
        occurredAt: receivedAt,
        actorId: actor.sub,
        type: 'transfer_in',
        costType: 'adjustment',
        reference: { type: 'Transfer', id },
        idempotencyKey: `transfer-in:${id}:${commandId}`,
        allowNegative: true,
        metadata: { transfer_number: transfer.transfer_number },
        lines: stockLines.map(({ item, qty }) => ({
          variantId: item.variant_id,
          qtyDelta: qty,
          referenceLineId: item.id,
          unitCost: item.unit_cost ?? ZERO,
        })),
      });
      await tx.$executeRaw`
        UPDATE "TransferItem" item
        SET "received_qty" = item."received_qty" + u."received",
            "damaged_qty" = item."damaged_qty" + u."damaged",
            "missing_qty" = item."missing_qty" + u."missing"
        FROM unnest(
          ${requested.map((receipt) => receipt.transfer_item_id)}::uuid[],
          ${requested.map((receipt) => receipt.received_qty.toFixed(3))}::numeric[],
          ${requested.map((receipt) => receipt.damaged_qty.toFixed(3))}::numeric[],
          ${requested.map((receipt) => receipt.missing_qty.toFixed(3))}::numeric[]
        ) AS u("id", "received", "damaged", "missing")
        WHERE item."id" = u."id"
      `;

      const nextStatus = remaining.isZero() ? 'received' : 'partially_received';
      await tx.$executeRaw`
        UPDATE "Transfer"
        SET "status" = ${nextStatus}::"TransferStatus",
            "received_by" = ${actor.sub}::uuid,
            "received_at" = CASE
              WHEN ${nextStatus} = 'received' THEN CURRENT_TIMESTAMP
              ELSE "received_at"
            END,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}::uuid
      `;
      await this.insertTransitMovements(tx, context, id, receivedAt, actor.sub, transfer.transfer_number, transit);
      await this.recordCommand(
        tx,
        context,
        id,
        'receive',
        commandId,
        fingerprint,
        nextStatus,
        actor.sub,
      );
      await this.audit(tx, context, actor.sub, 'transfer.received', id, {
        command_id: commandId,
        status: nextStatus,
        items: normalizedItems,
      });
      return this.loadTransfer(tx, context, id);
    });
  }

  async cancel(
    context: TenantContext,
    id: string,
    dto: CancelTransferDto,
    actor: AuthenticatedUser,
  ) {
    const commandId = resolveCommandId(dto.command_id);
    const fingerprint = commandFingerprint({
      transfer_id: id,
      action: 'cancel',
      reason: dto.reason.trim(),
    });
    return this.serializable(async (tx) => {
      await this.enableTransferCommand(tx);
      const transfer = await this.lockTransfer(tx, context, id);
      assertBranchAccess(actor, transfer.from_branch_id);
      if (
        await this.replayCommand(tx, context, id, 'cancel', commandId, fingerprint)
      ) {
        return this.loadTransfer(tx, context, id);
      }
      if (transfer.status !== 'pending') {
        throw new ConflictException(
          'Only a pending transfer can be cancelled',
        );
      }
      await tx.$executeRaw`
        UPDATE "Transfer"
        SET "status" = 'cancelled'::"TransferStatus",
            "cancelled_by" = ${actor.sub}::uuid,
            "cancelled_at" = CURRENT_TIMESTAMP,
            "cancellation_reason" = ${dto.reason.trim()},
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}::uuid
      `;
      await this.recordCommand(
        tx,
        context,
        id,
        'cancel',
        commandId,
        fingerprint,
        'cancelled',
        actor.sub,
      );
      await this.audit(tx, context, actor.sub, 'transfer.cancelled', id, {
        command_id: commandId,
        reason: dto.reason.trim(),
      });
      return this.loadTransfer(tx, context, id);
    });
  }

  async reconcileInTransit(context: TenantContext, actor: AuthenticatedUser) {
    if (!canAccessAllBranches(actor)) {
      throw new ConflictException(
        'Only a tenant-wide user can reconcile in-transit inventory',
      );
    }
    const mismatches = await this.prisma.$queryRaw<
      Array<{
        transfer_id: string;
        transfer_item_id: string;
        expected_in_transit: Prisma.Decimal;
        ledger_in_transit: Prisma.Decimal;
      }>
    >`
      WITH expected AS (
        SELECT
          item."transfer_id",
          item."id" AS transfer_item_id,
          item."shipped_qty" - item."received_qty" -
            item."damaged_qty" - item."missing_qty" AS expected_in_transit
        FROM "TransferItem" item
        WHERE item."tenant_id" = ${context.tenantId}::uuid
      ),
      ledger AS (
        SELECT
          movement."transfer_item_id",
          COALESCE(SUM(movement."quantity_delta"), 0) AS ledger_in_transit
        FROM "TransferTransitMovement" movement
        WHERE movement."tenant_id" = ${context.tenantId}::uuid
        GROUP BY movement."transfer_item_id"
      )
      SELECT
        expected."transfer_id",
        expected.transfer_item_id,
        expected.expected_in_transit,
        COALESCE(ledger.ledger_in_transit, 0) AS ledger_in_transit
      FROM expected
      LEFT JOIN ledger
        ON ledger."transfer_item_id" = expected.transfer_item_id
      WHERE expected.expected_in_transit
        <> COALESCE(ledger.ledger_in_transit, 0)
      ORDER BY expected."transfer_id", expected.transfer_item_id
      LIMIT 500
    `;
    return {
      ok: mismatches.length === 0,
      mismatch_count: mismatches.length,
      mismatches: mismatches.map((row) => ({
        ...row,
        ledger_in_transit: row.ledger_in_transit.toString(),
      })),
    };
  }

  /** Appends rows to the in-transit ledger: one multi-row INSERT for the whole command. */
  private insertTransitMovements(
    tx: Prisma.TransactionClient,
    context: TenantScope,
    transferId: string,
    occurredAt: Date,
    actorId: string,
    transferNumber: string,
    rows: TransitRow[],
  ) {
    if (!rows.length) return Promise.resolve(0);
    return tx.$executeRaw`
      INSERT INTO "TransferTransitMovement" (
        "transfer_id", "transfer_item_id", "variant_id", "movement_type",
        "quantity_delta", "in_transit_after", "idempotency_key",
        "occurred_at", "created_by", "metadata", "tenant_id"
      )
      SELECT
        ${transferId}::uuid, u."item_id", u."variant_id", u."type"::"TransferTransitMovementType",
        u."delta", u."after", u."key",
        ${occurredAt.toISOString()}::timestamp, ${actorId}::uuid,
        jsonb_build_object('transfer_number', ${transferNumber}::text),
        ${context.tenantId}::uuid
      FROM unnest(
        ${rows.map((row) => row.itemId)}::uuid[],
        ${rows.map((row) => row.variantId)}::uuid[],
        ${rows.map((row) => row.type)}::text[],
        ${rows.map((row) => row.delta.toFixed(3))}::numeric[],
        ${rows.map((row) => row.after.toFixed(3))}::numeric[],
        ${rows.map((row) => row.key)}::text[]
      ) AS u("item_id", "variant_id", "type", "delta", "after", "key")
    `;
  }

  private assertTransferVisibility(
    actor: AuthenticatedUser,
    transfer: Pick<Transfer, 'from_branch_id' | 'to_branch_id'>,
  ) {
    if (hasBranchAccess(actor, transfer.from_branch_id) || hasBranchAccess(actor, transfer.to_branch_id)) return;
    assertBranchAccess(actor, transfer.from_branch_id);
  }

  private serializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 15_000,
      timeout: 120_000,
    });
  }

  private enableTransferCommand(tx: Prisma.TransactionClient) {
    return tx.$queryRaw`
      SELECT set_config('bold.transfer_command', 'on', true)
    `;
  }

  private async nextTransferNumber(tx: Prisma.TransactionClient) {
    const [row] = await tx.$queryRaw<{ value: bigint }[]>`
      SELECT nextval('"TransferNumberSequence"') AS value
    `;
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    return `TR-${date}-${row.value.toString().padStart(8, '0')}`;
  }

  private async lockTransfer(
    tx: Prisma.TransactionClient,
    context: TenantScope,
    id: string,
  ) {
    const [transfer] = await tx.$queryRaw<TransferStateRow[]>`
      SELECT
        "status"::text, "transfer_number", "from_branch_id", "to_branch_id",
        "command_fingerprint"
      FROM "Transfer"
      WHERE "id" = ${id}::uuid AND "tenant_id" = ${context.tenantId}::uuid
      FOR UPDATE
    `;
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  private lockItems(
    tx: Prisma.TransactionClient,
    context: TenantScope,
    transferId: string,
  ) {
    return tx.$queryRaw<TransferItemState[]>`
      SELECT
        "id", "variant_id", "qty", "shipped_qty", "received_qty",
        "damaged_qty", "missing_qty", "unit_cost"
      FROM "TransferItem"
      WHERE "transfer_id" = ${transferId}::uuid
        AND "tenant_id" = ${context.tenantId}::uuid
      ORDER BY "variant_id", "id"
      FOR UPDATE
    `;
  }

  private loadTransfer(
    tx: Prisma.TransactionClient,
    context: TenantScope,
    id: string,
  ) {
    return tx.transfer.findFirstOrThrow({
      where: { id, tenant_id: context.tenantId },
      include: { items: { select: ITEM_COLUMNS }, from_branch: true, to_branch: true },
    });
  }

  private async replayCommand(
    tx: Prisma.TransactionClient,
    context: TenantScope,
    transferId: string,
    type: TransferCommandType,
    commandId: string,
    fingerprint: string,
  ) {
    const [existing] = await tx.$queryRaw<TransferCommandRow[]>`
      SELECT "command_fingerprint", "result_status"
      FROM "TransferCommand"
      WHERE "idempotency_key" = ${commandId}
        AND "tenant_id" = ${context.tenantId}::uuid
      FOR UPDATE
    `;
    if (!existing) return false;
    if (existing.command_fingerprint !== fingerprint) {
      throw new ConflictException(
        'Transfer command id belongs to a different payload',
      );
    }
    const [owned] = await tx.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM "TransferCommand"
        WHERE "idempotency_key" = ${commandId}
          AND "tenant_id" = ${context.tenantId}::uuid
          AND "transfer_id" = ${transferId}::uuid
          AND "command_type" = ${type}::"TransferCommandType"
      ) AS "exists"
    `;
    if (!owned.exists) {
      throw new ConflictException(
        'Transfer command id belongs to a different transfer or action',
      );
    }
    return true;
  }

  private recordCommand(
    tx: Prisma.TransactionClient,
    context: TenantScope,
    transferId: string,
    type: TransferCommandType,
    commandId: string,
    fingerprint: string,
    resultStatus: string,
    actorId: string,
  ) {
    return tx.$executeRaw`
      INSERT INTO "TransferCommand" (
        "id", "transfer_id", "command_type", "idempotency_key",
        "command_fingerprint", "result_status", "created_by", "tenant_id",
        "created_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${transferId}::uuid,
        ${type}::"TransferCommandType", ${commandId}, ${fingerprint},
        ${resultStatus}, ${actorId}::uuid, ${context.tenantId}::uuid,
        CURRENT_TIMESTAMP
      )
    `;
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: TenantScope,
    userId: string,
    action: string,
    entityId: string,
    meta: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        tenant_id: context.tenantId,
        user_id: userId,
        action,
        entity: 'Transfer',
        entity_id: entityId,
        meta,
      },
    });
  }
}
