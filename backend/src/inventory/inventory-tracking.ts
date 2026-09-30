import { ConflictException } from '@nestjs/common';
import type { Prisma, TrackingMode } from '@prisma/client';
import { cleanSerials, planBatches, planSerials } from './inventory-lot-plan';
import { readBatchRows, readSerialRows, writeBatchChanges, writeSerialChanges } from './inventory-lot-sql';
import type { ApplyStockCommand, StockLots, TrackingWarning } from './inventory.types';

type Tx = Prisma.TransactionClient;

/** A planned line of a serial- or batch-tracked variant, with the ledger row it belongs to. */
export type TrackedLine = {
  variantId: string;
  tracking: Exclude<TrackingMode, 'none'>;
  delta: Prisma.Decimal;
  lots?: StockLots;
};

/** Transfers of tracked stock arrive with W2b-2; until then the engine refuses them. */
const TRANSFER_TYPES = new Set(['transfer_out', 'transfer_in']);

/** Refuses what the engine cannot track, before anything is written. */
export function assertTrackable(command: ApplyStockCommand, lines: TrackedLine[]) {
  if (lines.length && TRANSFER_TYPES.has(command.type)) {
    throw new ConflictException({
      code: 'TRACKED_TRANSFER_NOT_SUPPORTED',
      message: 'Serial- and batch-tracked variants cannot be transferred yet',
      message_ar: 'لا يمكن تحويل الأصناف المتتبعة بالسيريال أو بالدفعات حاليًا.',
      variant_id: lines[0].variantId,
    });
  }
}

/**
 * Records the serials / batches a command moved, after its ledger rows exist
 * (`movementIds` maps variant -> movement id). At most four statements
 * (lock-read + write for serials, the same for batches) however many tracked
 * lines there are. Returns the warnings of lines accepted with a caveat.
 */
export async function applyTracking(
  tx: Tx,
  command: ApplyStockCommand,
  lines: TrackedLine[],
  movementIds: Map<string, string>,
): Promise<Map<string, TrackingWarning[]>> {
  const warnings = new Map<string, TrackingWarning[]>();
  const collect = (found: Map<string, Set<TrackingWarning>>) => {
    for (const [variantId, codes] of found) warnings.set(variantId, [...new Set([...(warnings.get(variantId) ?? []), ...codes])]);
  };
  // Only outbound lines of an acceptance-first command are tolerant.
  const tolerant = command.allowNegative;
  const withMovement = (line: TrackedLine) => ({ ...line, movementId: movementIds.get(line.variantId)! });

  const serialLines = lines.filter((line) => line.tracking === 'serial').map(withMovement);
  if (serialLines.length) {
    const pairs = serialLines.flatMap((line) =>
      cleanSerials(line.lots).serials.map((serial) => ({ variantId: line.variantId, serial })),
    );
    const rows = pairs.length ? await readSerialRows(tx, command.tenantId, pairs) : [];
    const plan = planSerials({
      lines: serialLines,
      rows,
      warehouseId: command.warehouseId,
      movementType: command.type,
      tolerant,
    });
    await writeSerialChanges(tx, command.tenantId, command.warehouseId, plan.writes);
    collect(plan.warnings);
  }

  const batchLines = lines.filter((line) => line.tracking === 'batch').map(withMovement);
  if (batchLines.length) {
    const rows = await readBatchRows(tx, command.tenantId, command.warehouseId, batchLines.map((line) => line.variantId));
    const plan = planBatches({ lines: batchLines, rows, tolerant, settleDeficit: command.type !== 'return' });
    await writeBatchChanges(tx, command.tenantId, command.warehouseId, plan.changes);
    collect(plan.warnings);
  }
  return warnings;
}
