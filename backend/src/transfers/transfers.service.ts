import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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
import { assertBranchAccess } from '../auth/branch-access';
import {
  commandFingerprint,
  resolveCommandId,
  TransferCommandType,
} from './transfer-command';

type TransferCommandRow = {
  command_fingerprint: string;
  result_status: string;
};

type TransferStateRow = {
  status: string;
  from_branch_id: string;
  to_branch_id: string;
  command_fingerprint: string | null;
};

type TransferItemState = {
  id: string;
  variant_id: string;
  qty: number;
  shipped_qty: number;
  received_qty: number;
  damaged_qty: number;
  missing_qty: number;
};

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}

  list(context: TenantContext, branch_id?: string) {
    return this.prisma.transfer.findMany({
      where: {
        tenant_id: context.tenantId,
        ...(branch_id
          ? { OR: [{ from_branch_id: branch_id }, { to_branch_id: branch_id }] }
          : {}),
      },
      include: { from_branch: true, to_branch: true, items: true },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  async get(context: TenantContext, id: string, actor: AuthenticatedUser) {
    const transfer = await this.prisma.transfer.findFirst({
      where: { id, tenant_id: context.tenantId },
      include: {
        from_branch: true,
        to_branch: true,
        items: { include: { variant: { include: { product: true } } } },
      },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    this.assertTransferVisibility(actor, transfer);
    const [state] = await this.prisma.$queryRaw<TransferStateRow[]>`
      SELECT "status"::text, "from_branch_id", "to_branch_id", "command_fingerprint"
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
    assertBranchAccess(actor, dto.from_branch_id, [
      'owner',
      'warehouse_manager',
    ]);

    const quantities = new Map<string, number>();
    for (const item of dto.items) {
      quantities.set(
        item.variant_id,
        (quantities.get(item.variant_id) || 0) + item.qty,
      );
    }
    const items = [...quantities.entries()]
      .map(([variant_id, qty]) => ({ variant_id, qty }))
      .sort((left, right) => left.variant_id.localeCompare(right.variant_id));
    const commandId = resolveCommandId(dto.command_id);
    const fingerprint = commandFingerprint({
      from_branch_id: dto.from_branch_id,
      to_branch_id: dto.to_branch_id,
      items,
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

      const [branches, variantCount] = await Promise.all([
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
        tx.productVariant.count({
          where: {
            id: { in: items.map((item) => item.variant_id) },
            tenant_id: context.tenantId,
          },
        }),
      ]);
      if (branches !== 2) {
        throw new NotFoundException('One or more active branches were not found');
      }
      if (variantCount !== items.length) {
        throw new NotFoundException(
          'One or more product variants were not found',
        );
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
      for (const item of items) {
        await tx.$executeRaw`
          INSERT INTO "TransferItem" (
            "id", "transfer_id", "variant_id", "qty",
            "shipped_qty", "received_qty", "damaged_qty", "missing_qty",
            "tenant_id"
          ) VALUES (
            ${randomUUID()}::uuid, ${id}::uuid, ${item.variant_id}::uuid,
            ${item.qty}, 0, 0, 0, 0, ${context.tenantId}::uuid
          )
        `;
      }
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
      assertBranchAccess(actor, transfer.from_branch_id, [
        'owner',
        'warehouse_manager',
      ]);
      if (
        await this.replayCommand(tx, context, id, 'ship', commandId, fingerprint)
      ) {
        return this.loadTransfer(tx, context, id);
      }
      if (transfer.status !== 'pending') {
        throw new ConflictException('Only a pending transfer can be shipped');
      }

      const items = await this.lockItems(tx, context, id);
      for (const item of items) {
        const changed = await tx.$executeRaw`
          UPDATE "InventoryStock"
          SET "qty_on_hand" = "qty_on_hand" - ${item.qty}
          WHERE "branch_id" = ${transfer.from_branch_id}::uuid
            AND "tenant_id" = ${context.tenantId}::uuid
            AND "variant_id" = ${item.variant_id}::uuid
            AND ("qty_on_hand" - "qty_reserved") >= ${item.qty}
        `;
        if (changed !== 1) {
          throw new ConflictException(
            `Insufficient available stock for variant ${item.variant_id}`,
          );
        }
        await tx.$executeRaw`
          UPDATE "TransferItem"
          SET "shipped_qty" = "qty"
          WHERE "id" = ${item.id}::uuid
        `;
      }
      await tx.$executeRaw`
        UPDATE "Transfer"
        SET "status" = 'shipped'::"TransferStatus",
            "shipped_by" = ${actor.sub}::uuid,
            "shipped_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}::uuid
      `;
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
      assertBranchAccess(actor, transfer.to_branch_id, [
        'owner',
        'warehouse_manager',
      ]);
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
      const requested = normalizedItems.length
        ? normalizedItems
        : items.map((item) => ({
            transfer_item_id: item.id,
            received_qty:
              item.shipped_qty -
              item.received_qty -
              item.damaged_qty -
              item.missing_qty,
            damaged_qty: 0,
            missing_qty: 0,
          }));
      const requestIds = new Set(requested.map((item) => item.transfer_item_id));
      if (requestIds.size !== requested.length) {
        throw new BadRequestException('Duplicate transfer item in receipt');
      }

      for (const receipt of requested) {
        const item = items.find(
          (candidate) => candidate.id === receipt.transfer_item_id,
        );
        if (!item) {
          throw new BadRequestException(
            `Transfer item ${receipt.transfer_item_id} does not belong to this transfer`,
          );
        }
        const resolved =
          receipt.received_qty + receipt.damaged_qty + receipt.missing_qty;
        const outstanding =
          item.shipped_qty -
          item.received_qty -
          item.damaged_qty -
          item.missing_qty;
        if (resolved <= 0 || resolved > outstanding) {
          throw new BadRequestException(
            `Invalid receipt quantities for transfer item ${item.id}`,
          );
        }

        if (receipt.received_qty > 0) {
          await tx.inventoryStock.upsert({
            where: {
              branch_id_variant_id: {
                branch_id: transfer.to_branch_id,
                variant_id: item.variant_id,
              },
            },
            update: { qty_on_hand: { increment: receipt.received_qty } },
            create: {
              tenant_id: context.tenantId,
              branch_id: transfer.to_branch_id,
              variant_id: item.variant_id,
              qty_on_hand: receipt.received_qty,
            },
          });
        } else {
          await tx.inventoryStock.upsert({
            where: {
              branch_id_variant_id: {
                branch_id: transfer.to_branch_id,
                variant_id: item.variant_id,
              },
            },
            update: {},
            create: {
              tenant_id: context.tenantId,
              branch_id: transfer.to_branch_id,
              variant_id: item.variant_id,
              qty_on_hand: 0,
            },
          });
        }
        await tx.$executeRaw`
          UPDATE "TransferItem"
          SET "received_qty" = "received_qty" + ${receipt.received_qty},
              "damaged_qty" = "damaged_qty" + ${receipt.damaged_qty},
              "missing_qty" = "missing_qty" + ${receipt.missing_qty}
          WHERE "id" = ${item.id}::uuid
        `;
      }

      const [remaining] = await tx.$queryRaw<{ quantity: bigint }[]>`
        SELECT COALESCE(SUM(
          "shipped_qty" - "received_qty" - "damaged_qty" - "missing_qty"
        ), 0)::bigint AS quantity
        FROM "TransferItem"
        WHERE "transfer_id" = ${id}::uuid
      `;
      const nextStatus = remaining.quantity === 0n ? 'received' : 'partially_received';
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
        items: requested,
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
      assertBranchAccess(actor, transfer.from_branch_id, [
        'owner',
        'warehouse_manager',
      ]);
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
    if (actor.role !== 'owner' && actor.role !== 'warehouse_manager') {
      throw new ConflictException(
        'Only owner or warehouse manager can reconcile in-transit inventory',
      );
    }
    const mismatches = await this.prisma.$queryRaw<
      Array<{
        transfer_id: string;
        transfer_item_id: string;
        expected_in_transit: number;
        ledger_in_transit: bigint;
      }>
    >`
      WITH expected AS (
        SELECT
          item."transfer_id",
          item."id" AS transfer_item_id,
          item."shipped_qty" - item."received_qty" -
            item."damaged_qty" - item."missing_qty" AS expected_in_transit
        FROM "TransferItem" item
        -- DRILL BREAK (scratch/wp-t2-f4-guard-drill, R2 positive-direction):
        -- tenant predicate over-scoped on purpose (compared against a fixed
        -- nonexistent tenant instead of the calling tenant) to prove R2's
        -- "includes tenant A's own mismatched item" check actually fails
        -- when it should. Restored in the very next commit on this branch.
        WHERE item."tenant_id" = '00000000-0000-0000-0000-000000000000'::uuid
      ),
      ledger AS (
        SELECT
          movement."transfer_item_id",
          COALESCE(SUM(movement."quantity_delta"), 0)::bigint AS ledger_in_transit
        FROM "TransferTransitMovement" movement
        WHERE movement."tenant_id" = ${context.tenantId}::uuid
        GROUP BY movement."transfer_item_id"
      )
      SELECT
        expected."transfer_id",
        expected.transfer_item_id,
        expected.expected_in_transit,
        COALESCE(ledger.ledger_in_transit, 0)::bigint AS ledger_in_transit
      FROM expected
      LEFT JOIN ledger
        ON ledger."transfer_item_id" = expected.transfer_item_id
      WHERE expected.expected_in_transit::bigint
        <> COALESCE(ledger.ledger_in_transit, 0)::bigint
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

  private assertTransferVisibility(
    actor: AuthenticatedUser,
    transfer: Pick<Transfer, 'from_branch_id' | 'to_branch_id'>,
  ) {
    if (actor.role === 'owner' || actor.role === 'warehouse_manager') return;
    if (
      actor.branch_id !== transfer.from_branch_id &&
      actor.branch_id !== transfer.to_branch_id
    ) {
      assertBranchAccess(actor, transfer.from_branch_id);
    }
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
        "status"::text, "from_branch_id", "to_branch_id",
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
        "damaged_qty", "missing_qty"
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
      include: { items: true, from_branch: true, to_branch: true },
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
