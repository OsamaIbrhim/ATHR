import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { BatchChange, BatchRow, SerialRow, SerialWrite } from './inventory-lot-plan';

type Tx = Prisma.TransactionClient;

/**
 * The statements behind tracked lines: one locking read and one bulk write
 * per kind (serial / batch), whatever the number of lines. Callers hold the
 * warehouse's stock-row lock already, so these rows are only ever touched by
 * one command at a time; the row locks here are the second, explicit layer.
 * Rows are always locked in a fixed order.
 */

/** Live batch rows (and the unallocated row) of some variants in one warehouse. */
export function readBatchRows(tx: Tx, tenantId: string, warehouseId: string, variantIds: string[]) {
  return tx.$queryRaw<BatchRow[]>`
    SELECT "variant_id", "batch_no", "expiry_date", "qty", "created_at"
    FROM "InventoryBatch"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND "warehouse_id" = ${warehouseId}::uuid
      AND "variant_id" = ANY(${variantIds}::uuid[])
      AND ("qty" > 0 OR "batch_no" = '')
    ORDER BY "variant_id", "batch_no"
    FOR UPDATE
  `;
}

/** The rows of the named serials that already exist. */
export function readSerialRows(tx: Tx, tenantId: string, pairs: Array<{ variantId: string; serial: string }>) {
  return tx.$queryRaw<SerialRow[]>`
    SELECT s."variant_id", s."serial", s."status", s."warehouse_id"
    FROM "InventorySerial" s
    JOIN unnest(${pairs.map((pair) => pair.variantId)}::uuid[], ${pairs.map((pair) => pair.serial)}::text[])
      AS u("variant_id", "serial") ON u."variant_id" = s."variant_id" AND u."serial" = s."serial"
    WHERE s."tenant_id" = ${tenantId}::uuid
    ORDER BY s."variant_id", s."serial"
    FOR UPDATE OF s
  `;
}

/**
 * Applies batch quantity changes (creating batches on first sight) and logs
 * each as a lot movement. Additions and the unallocated row go through an
 * upsert; drawing a real batch down is an UPDATE, because Postgres checks the
 * CHECK constraint on the row an upsert proposes to insert (a negative delta
 * would fail there even though the batch exists and stays positive).
 */
export async function writeBatchChanges(tx: Tx, tenantId: string, warehouseId: string, changes: BatchChange[]) {
  if (!changes.length) return;
  await tx.$executeRaw`
    WITH input AS (
      SELECT u."variant_id", u."movement_id", u."batch_no", NULLIF(u."expiry", '')::date AS "expiry_date", u."delta"
      FROM unnest(
        ${changes.map((change) => change.variantId)}::uuid[],
        ${changes.map((change) => change.movementId)}::uuid[],
        ${changes.map((change) => change.batchNo)}::text[],
        ${changes.map((change) => change.expiryDate ?? '')}::text[],
        ${changes.map((change) => change.delta.toFixed(3))}::numeric[]
      ) AS u("variant_id", "movement_id", "batch_no", "expiry", "delta")
    ),
    added AS (
      INSERT INTO "InventoryBatch" ("tenant_id", "warehouse_id", "variant_id", "batch_no", "expiry_date", "qty")
      SELECT ${tenantId}::uuid, ${warehouseId}::uuid, "variant_id", "batch_no", "expiry_date", "delta"
      FROM input WHERE "delta" >= 0 OR "batch_no" = ''
      ON CONFLICT ("tenant_id", "warehouse_id", "variant_id", "batch_no") DO UPDATE
        SET "qty" = "InventoryBatch"."qty" + EXCLUDED."qty",
            "expiry_date" = COALESCE("InventoryBatch"."expiry_date", EXCLUDED."expiry_date")
      RETURNING "id", "variant_id", "batch_no"
    ),
    drawn AS (
      UPDATE "InventoryBatch" b SET "qty" = b."qty" + i."delta"
      FROM input i
      WHERE i."delta" < 0 AND i."batch_no" <> ''
        AND b."tenant_id" = ${tenantId}::uuid AND b."warehouse_id" = ${warehouseId}::uuid
        AND b."variant_id" = i."variant_id" AND b."batch_no" = i."batch_no"
      RETURNING b."id", b."variant_id", b."batch_no"
    ),
    upserted AS (
      SELECT * FROM added UNION ALL SELECT * FROM drawn
    )
    INSERT INTO "InventoryLotMovement" ("tenant_id", "movement_id", "batch_id", "qty_delta")
    SELECT ${tenantId}::uuid, i."movement_id", b."id", i."delta"
    FROM input i
    JOIN upserted b ON b."variant_id" = i."variant_id" AND b."batch_no" = i."batch_no"
    WHERE i."delta" <> 0
  `;
}

/**
 * Moves serials to their new status and logs each as a lot movement. A serial
 * coming into stock may only replace one that had left it; when a concurrent
 * command got there first the upsert skips the row and the count falls short.
 */
export async function writeSerialChanges(tx: Tx, tenantId: string, warehouseId: string, writes: SerialWrite[]) {
  if (!writes.length) return;
  const applied = await tx.$queryRaw<Array<{ id: string }>>`
    WITH input AS (
      SELECT u."variant_id", u."movement_id", u."serial", u."status"::"SerialStatus" AS "status", u."delta"
      FROM unnest(
        ${writes.map((write) => write.variantId)}::uuid[],
        ${writes.map((write) => write.movementId)}::uuid[],
        ${writes.map((write) => write.serial)}::text[],
        ${writes.map((write) => write.status)}::text[],
        ${writes.map((write) => write.delta)}::int[]
      ) AS u("variant_id", "movement_id", "serial", "status", "delta")
    ),
    upserted AS (
      INSERT INTO "InventorySerial" ("tenant_id", "variant_id", "serial", "warehouse_id", "status")
      SELECT ${tenantId}::uuid, "variant_id", "serial",
             CASE WHEN "status" = 'in_stock' THEN ${warehouseId}::uuid END, "status"
      FROM input
      ON CONFLICT ("tenant_id", "variant_id", "serial") DO UPDATE
        SET "status" = EXCLUDED."status", "warehouse_id" = EXCLUDED."warehouse_id"
        WHERE EXCLUDED."status" <> 'in_stock' OR "InventorySerial"."status" IN ('sold', 'returned_to_supplier')
      RETURNING "id", "variant_id", "serial"
    ),
    lots AS (
      INSERT INTO "InventoryLotMovement" ("tenant_id", "movement_id", "serial_id", "qty_delta")
      SELECT ${tenantId}::uuid, i."movement_id", s."id", i."delta"
      FROM input i
      JOIN upserted s ON s."variant_id" = i."variant_id" AND s."serial" = i."serial"
      RETURNING 1
    )
    SELECT "id" FROM upserted
  `;
  if (applied.length < writes.length) {
    throw new ConflictException({
      code: 'TRACKING_SERIAL_ALREADY_IN_STOCK',
      message: 'A serial number was received by another command at the same time',
      message_ar: 'رقم تسلسلي استُلم بالفعل من عملية أخرى في نفس الوقت.',
    });
  }
}
