import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { quantity } from '../common/quantity';
import { planCostMovement, type CostPlan } from './inventory-cost';
import type { ApplyStockCommand, StockAfter, StockLine } from './inventory.types';

type Tx = Prisma.TransactionClient;

type LockedRow = {
  variant_id: string;
  qty_on_hand: Prisma.Decimal;
  qty_reserved: Prisma.Decimal;
  avg_cost: Prisma.Decimal;
};

type PlannedLine = {
  line: StockLine;
  delta: Prisma.Decimal;
  before: LockedRow;
  after: Prisma.Decimal;
  cost: CostPlan | null;
};

const iso = (date: Date) => date.toISOString();

/** Command + line metadata as one JSON text; '' (stored as NULL) when there is none. */
function metadataText(command: ApplyStockCommand, line: StockLine) {
  const merged = { ...command.metadata, ...line.metadata };
  return Object.keys(merged).length ? JSON.stringify(merged) : '';
}

/**
 * Applies one inventory command in a constant number of statements however
 * many lines it has:
 *
 *   1. lock the stock rows          (SELECT ... ORDER BY variant FOR UPDATE)
 *      [+ create missing rows, first sight of a variant only]
 *   2. insert the ledger rows       (one multi-row INSERT, idempotency = unique key)
 *   3. update the stock rows        (one set-based UPDATE)
 *   4. cost commands only: cost ledger INSERT + variant cost UPDATE
 *
 * Lines of variants that are not `stocked` (service / non_stock) are skipped.
 * Must run inside the caller's transaction; a thrown error must roll it back.
 */
export async function applyStock(tx: Tx, command: ApplyStockCommand): Promise<StockAfter[]> {
  const lines = normalizeLines(command);
  if (!lines.length) return [];
  const variantIds = lines.map((line) => line.variantId);

  const locked = await lockOrCreateRows(tx, command, variantIds);
  if (!locked.size) return [];

  const planned: PlannedLine[] = lines
    .filter((line) => locked.has(line.variantId))
    .map((line) => {
      const before = locked.get(line.variantId)!;
      const delta = quantity(line.qtyDelta);
      return {
        line,
        delta,
        before,
        after: before.qty_on_hand.plus(delta),
        cost: command.costType
          ? planCostMovement(command.costType, line, delta, before.qty_on_hand, before.avg_cost)
          : null,
      };
    });

  const shortage = command.allowNegative ? undefined : planned.find(isShort);
  if (shortage) {
    // A replay of an already-applied command must not fail on today's stock.
    const replay = await readReplay(tx, command, planned);
    if (replay) return replay;
    throw new ConflictException({
      code: 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
      message: `Insufficient available stock for variant ${shortage.line.variantId}`,
      message_ar: 'الكمية المتاحة من المخزون غير كافية لإتمام العملية.',
      variant_id: shortage.line.variantId,
    });
  }

  const inserted = await insertMovements(tx, command, planned);
  if (inserted < planned.length) {
    if (inserted === 0) {
      const replay = await readReplay(tx, command, planned);
      if (replay) return replay;
    }
    throw new ConflictException(
      `Inventory idempotency key belongs to a different command: ${command.idempotencyKey}`,
    );
  }

  await updateStock(tx, command, planned);
  if (command.costType) await writeCosts(tx, command, planned);

  return planned.map(toStockAfter);
}

/** Read helper for callers that must price a removal before posting it (supplier returns). */
export async function readAverageCosts(
  db: Pick<Tx, '$queryRaw'>,
  tenantId: string,
  warehouseId: string,
  variantIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  const rows = await db.$queryRaw<Array<{ variant_id: string; avg_cost: Prisma.Decimal }>>`
    SELECT "variant_id", "avg_cost"
    FROM "InventoryStock"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "warehouse_id" = ${warehouseId}::uuid
      AND "variant_id" = ANY(${variantIds}::uuid[])
  `;
  return new Map(rows.map((row) => [row.variant_id, row.avg_cost]));
}

function normalizeLines(command: ApplyStockCommand): StockLine[] {
  const seen = new Set<string>();
  for (const line of command.lines) {
    if (seen.has(line.variantId)) {
      throw new BadRequestException(`Inventory command repeats variant ${line.variantId}; merge its lines first`);
    }
    seen.add(line.variantId);
    let delta: Prisma.Decimal;
    try {
      delta = quantity(line.qtyDelta);
    } catch {
      throw new BadRequestException(`Invalid inventory quantity for variant ${line.variantId}`);
    }
    if (delta.isZero()) {
      throw new BadRequestException(`Inventory quantity change cannot be zero (variant ${line.variantId})`);
    }
  }
  return [...command.lines].sort((left, right) => left.variantId.localeCompare(right.variantId));
}

const isShort = (item: PlannedLine) =>
  item.after.minus(item.before.qty_reserved).isNegative() && item.delta.isNegative();

async function lockRows(tx: Tx, command: ApplyStockCommand, variantIds: string[]) {
  return tx.$queryRaw<LockedRow[]>`
    SELECT s."variant_id", s."qty_on_hand", s."qty_reserved", s."avg_cost"
    FROM "InventoryStock" s
    JOIN "ProductVariant" v ON v."id" = s."variant_id" AND v."tenant_id" = s."tenant_id"
    WHERE s."tenant_id" = ${command.tenantId}::uuid
      AND s."warehouse_id" = ${command.warehouseId}::uuid
      AND s."variant_id" = ANY(${variantIds}::uuid[])
      AND v."item_type" = 'stocked'
    ORDER BY s."variant_id"
    FOR UPDATE OF s
  `;
}

async function lockOrCreateRows(tx: Tx, command: ApplyStockCommand, variantIds: string[]) {
  const rows = new Map((await lockRows(tx, command, variantIds)).map((row) => [row.variant_id, row]));
  if (rows.size < variantIds.length) {
    // First sight of some variants in this warehouse: one statement creates
    // their rows (seeded with the variant's catalog cost) and reports which
    // stocked variants it created. Non-stocked variants do not appear at all.
    const missing = variantIds.filter((id) => !rows.has(id));
    const stocked = await tx.$queryRaw<Array<{ variant_id: string; cost_price: Prisma.Decimal; inserted: boolean }>>`
      WITH stocked AS (
        SELECT v."id", v."cost_price"
        FROM "ProductVariant" v
        WHERE v."tenant_id" = ${command.tenantId}::uuid
          AND v."id" = ANY(${missing}::uuid[])
          AND v."item_type" = 'stocked'
        ORDER BY v."id"
      ),
      created AS (
        INSERT INTO "InventoryStock" ("tenant_id", "warehouse_id", "variant_id", "avg_cost")
        SELECT ${command.tenantId}::uuid, ${command.warehouseId}::uuid, "id", "cost_price" FROM stocked
        ON CONFLICT ("warehouse_id", "variant_id") DO NOTHING
        RETURNING "variant_id"
      )
      SELECT s."id" AS "variant_id", s."cost_price",
             (s."id" IN (SELECT "variant_id" FROM created)) AS "inserted"
      FROM stocked s
    `;
    const zero = new Prisma.Decimal(0);
    for (const row of stocked.filter((candidate) => candidate.inserted)) {
      rows.set(row.variant_id, { variant_id: row.variant_id, qty_on_hand: zero, qty_reserved: zero, avg_cost: row.cost_price });
    }
    // Rows another transaction created a moment ago: lock them like any other row.
    const concurrent = stocked.filter((candidate) => !candidate.inserted).map((candidate) => candidate.variant_id);
    if (concurrent.length) {
      for (const row of await lockRows(tx, command, concurrent)) rows.set(row.variant_id, row);
    }
  }
  return rows;
}

async function insertMovements(tx: Tx, command: ApplyStockCommand, planned: PlannedLine[]) {
  const rows = await tx.$queryRaw<Array<{ variant_id: string }>>`
    INSERT INTO "InventoryMovement" (
      "tenant_id", "warehouse_id", "variant_id", "movement_type",
      "on_hand_delta", "reserved_delta", "on_hand_after", "reserved_after",
      "reference_type", "reference_id", "reference_line_id",
      "idempotency_key", "occurred_at", "created_by", "metadata"
    )
    SELECT
      ${command.tenantId}::uuid, ${command.warehouseId}::uuid, u."variant_id",
      ${command.type}::"InventoryMovementType",
      u."delta", 0, u."after", u."reserved",
      ${command.reference.type}, ${command.reference.id}, NULLIF(u."line_id", ''),
      ${command.idempotencyKey}, ${iso(command.occurredAt)}::timestamp,
      ${command.actorId ?? null}::uuid, NULLIF(u."metadata", '')::jsonb
    FROM unnest(
      ${planned.map((p) => p.line.variantId)}::uuid[],
      ${planned.map((p) => p.delta.toFixed(3))}::numeric[],
      ${planned.map((p) => p.after.toFixed(3))}::numeric[],
      ${planned.map((p) => p.before.qty_reserved.toFixed(3))}::numeric[],
      ${planned.map((p) => p.line.referenceLineId ?? '')}::text[],
      ${planned.map((p) => metadataText(command, p.line))}::text[]
    ) AS u("variant_id", "delta", "after", "reserved", "line_id", "metadata")
    -- A key that already holds rows of other variants belongs to another command.
    WHERE NOT EXISTS (
      SELECT 1 FROM "InventoryMovement" other
      WHERE other."tenant_id" = ${command.tenantId}::uuid
        AND other."idempotency_key" = ${command.idempotencyKey}
        AND other."variant_id" <> ALL(${planned.map((p) => p.line.variantId)}::uuid[])
    )
    ON CONFLICT ("tenant_id", "idempotency_key", "variant_id") DO NOTHING
    RETURNING "variant_id"
  `;
  return rows.length;
}

async function updateStock(tx: Tx, command: ApplyStockCommand, planned: PlannedLine[]) {
  await tx.$executeRaw`
    UPDATE "InventoryStock" s
    SET "qty_on_hand" = s."qty_on_hand" + u."delta",
        "avg_cost" = u."avg_cost",
        "last_sold_at" = COALESCE(${command.type === 'sale' ? iso(command.occurredAt) : null}::timestamp, s."last_sold_at")
    FROM unnest(
      ${planned.map((p) => p.line.variantId)}::uuid[],
      ${planned.map((p) => p.delta.toFixed(3))}::numeric[],
      ${planned.map((p) => (p.cost ? p.cost.costAfter : p.before.avg_cost).toFixed(4))}::numeric[]
    ) AS u("variant_id", "delta", "avg_cost")
    WHERE s."tenant_id" = ${command.tenantId}::uuid
      AND s."warehouse_id" = ${command.warehouseId}::uuid
      AND s."variant_id" = u."variant_id"
  `;
}

async function writeCosts(tx: Tx, command: ApplyStockCommand, planned: PlannedLine[]) {
  const costed = planned.filter((p): p is PlannedLine & { cost: CostPlan } => p.cost !== null);
  const links = (p: PlannedLine) => p.line.links ?? {};
  const text = (pick: (p: PlannedLine) => string | undefined) => costed.map((p) => pick(p) ?? '');
  const money = (pick: (c: CostPlan) => Prisma.Decimal, scale: number) =>
    costed.map((p) => pick(p.cost).toFixed(scale));

  await tx.$executeRaw`
    INSERT INTO "InventoryCostMovement" (
      "tenant_id", "warehouse_id", "variant_id", "movement_type",
      "quantity_delta", "quantity_before", "quantity_after",
      "unit_cost", "cost_before", "cost_after",
      "inventory_value_before", "movement_value", "inventory_value_after", "rounding_adjustment",
      "reference_type", "reference_id", "reference_line_id",
      "purchase_invoice_id", "purchase_invoice_item_id", "supplier_return_id", "supplier_return_item_id",
      "idempotency_key", "occurred_at", "created_by", "metadata"
    )
    SELECT
      ${command.tenantId}::uuid, ${command.warehouseId}::uuid, u."variant_id",
      ${command.costType}::"InventoryCostMovementType",
      u."delta", u."qty_before", u."qty_after",
      u."unit_cost", u."cost_before", u."cost_after",
      u."value_before", u."value", u."value_after", u."rounding",
      ${command.reference.type}, ${command.reference.id}, NULLIF(u."line_id", ''),
      NULLIF(u."pi", '')::uuid, NULLIF(u."pii", '')::uuid, NULLIF(u."sr", '')::uuid, NULLIF(u."sri", '')::uuid,
      ${command.idempotencyKey}, ${iso(command.occurredAt)}::timestamp,
      ${command.actorId ?? null}::uuid, NULLIF(u."metadata", '')::jsonb
    FROM unnest(
      ${costed.map((p) => p.line.variantId)}::uuid[],
      ${costed.map((p) => p.delta.toFixed(3))}::numeric[],
      ${money((c) => c.quantityBefore, 3)}::numeric[],
      ${money((c) => c.quantityAfter, 3)}::numeric[],
      ${money((c) => c.unitCost, 4)}::numeric[],
      ${money((c) => c.costBefore, 4)}::numeric[],
      ${money((c) => c.costAfter, 4)}::numeric[],
      ${money((c) => c.valueBefore, 2)}::numeric[],
      ${money((c) => c.movementValue, 2)}::numeric[],
      ${money((c) => c.valueAfter, 2)}::numeric[],
      ${money((c) => c.roundingAdjustment, 2)}::numeric[],
      ${text((p) => p.line.referenceLineId)}::text[],
      ${text((p) => links(p).purchaseInvoiceId)}::text[],
      ${text((p) => links(p).purchaseInvoiceItemId)}::text[],
      ${text((p) => links(p).supplierReturnId)}::text[],
      ${text((p) => links(p).supplierReturnItemId)}::text[],
      ${costed.map((p) => metadataText(command, p.line))}::text[]
    ) AS u(
      "variant_id", "delta", "qty_before", "qty_after", "unit_cost", "cost_before", "cost_after",
      "value_before", "value", "value_after", "rounding",
      "line_id", "pi", "pii", "sr", "sri", "metadata"
    )
  `;

  // ProductVariant.cost_price mirrors the average of the latest cost movement
  // (pricing floors and admin read it), which keeps cost reconciliation exact.
  // The guard trigger only lets this statement change it; the flag is
  // transaction-local.
  await tx.$executeRaw`
    UPDATE "ProductVariant" v
    SET "cost_price" = u."cost"
    FROM unnest(
      ${costed.map((p) => p.line.variantId)}::uuid[],
      ${costed.map((p) => p.cost.costAfter.toFixed(4))}::numeric[]
    ) AS u("variant_id", "cost"),
    (SELECT set_config('bold.inventory_cost_materialization_write', 'on', true)) AS guard
    WHERE v."tenant_id" = ${command.tenantId}::uuid AND v."id" = u."variant_id"
  `;
}

type ReplayRow = {
  variant_id: string;
  warehouse_id: string;
  on_hand_delta: Prisma.Decimal;
  on_hand_after: Prisma.Decimal;
  reserved_after: Prisma.Decimal;
};

/** The result of an already-applied command, or null when the key is unused. */
async function readReplay(
  tx: Tx,
  command: ApplyStockCommand,
  planned: PlannedLine[],
): Promise<StockAfter[] | null> {
  const rows = await tx.$queryRaw<ReplayRow[]>`
    SELECT "variant_id", "warehouse_id", "on_hand_delta", "on_hand_after", "reserved_after"
    FROM "InventoryMovement"
    WHERE "tenant_id" = ${command.tenantId}::uuid AND "idempotency_key" = ${command.idempotencyKey}
  `;
  if (!rows.length) return null;
  const byVariant = new Map(rows.map((row) => [row.variant_id, row]));
  const sameCommand =
    rows.length === planned.length &&
    planned.every((p) => {
      const row = byVariant.get(p.line.variantId);
      return row && row.warehouse_id === command.warehouseId && row.on_hand_delta.equals(p.delta);
    });
  if (!sameCommand) {
    throw new ConflictException(
      `Inventory idempotency key belongs to a different command: ${command.idempotencyKey}`,
    );
  }
  return planned.map((p) => {
    const row = byVariant.get(p.line.variantId)!;
    return {
      variantId: p.line.variantId,
      qtyBefore: row.on_hand_after.minus(row.on_hand_delta),
      qtyAfter: row.on_hand_after,
      reserved: row.reserved_after,
      avgCostBefore: p.before.avg_cost,
      avgCost: p.before.avg_cost,
    };
  });
}

function toStockAfter(item: PlannedLine): StockAfter {
  return {
    variantId: item.line.variantId,
    qtyBefore: item.before.qty_on_hand,
    qtyAfter: item.after,
    reserved: item.before.qty_reserved,
    avgCostBefore: item.before.avg_cost,
    avgCost: item.cost ? item.cost.costAfter : item.before.avg_cost,
  };
}
