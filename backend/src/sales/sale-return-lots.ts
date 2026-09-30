import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cleanSerials, fefoOrder, serialKey, UNALLOCATED, type SerialRow } from '../inventory/inventory-lot-plan';
import type { DrawnLots } from '../inventory/inventory-lot-sql';
import type { InventoryService } from '../inventory/inventory.service';
import type { StockLots } from '../inventory/inventory.types';

/** One returned sale line of a serial- or batch-tracked variant. */
export type ReturnLine = {
  saleItemId: string;
  variantId: string;
  tracking: 'serial' | 'batch';
  /** Quantity on the sale line, and what earlier returns already took back. */
  soldQty: Prisma.Decimal;
  returnedBefore: Prisma.Decimal;
  /** Quantity coming back now and the serials the request names. */
  qty: Prisma.Decimal;
  serials: string[];
};

const ZERO = new Prisma.Decimal(0);

/**
 * Reads what a return of tracked lines needs (the sale lines' lots, the state
 * of the serials named) and plans the lots to put back, per sale line. Costs
 * nothing when no returned line is serial- or batch-tracked.
 */
export async function loadReturnLots(input: {
  inventory: InventoryService;
  tx: Prisma.TransactionClient;
  tenantId: string;
  invoiceId: string;
  warehouseId: string;
  /** Quantity coming back per sale line, and the serials named for it. */
  requested: Map<string, Prisma.Decimal>;
  serials: Map<string, string[]>;
  /** The sale lines, and what earlier returns took back from them. */
  sold: Map<string, { variant_id: string; qty: Prisma.Decimal; variant: { item_type: string; tracking?: string } }>;
  returnedBefore: Map<string, Prisma.Decimal>;
}): Promise<Map<string, StockLots>> {
  const lines: ReturnLine[] = [];
  for (const [saleItemId, qty] of input.requested) {
    const sold = input.sold.get(saleItemId)!;
    const tracking = sold.variant.tracking;
    if (sold.variant.item_type !== 'stocked' || (tracking !== 'serial' && tracking !== 'batch')) continue;
    lines.push({
      saleItemId,
      variantId: sold.variant_id,
      tracking,
      soldQty: sold.qty,
      returnedBefore: input.returnedBefore.get(saleItemId) ?? ZERO,
      qty,
      serials: input.serials.get(saleItemId) ?? [],
    });
  }
  if (!lines.length) return new Map();

  const named = lines.flatMap((line) =>
    line.tracking === 'serial' ? line.serials.map((serial) => ({ variantId: line.variantId, serial: serial.trim() })) : [],
  );
  const drawn = await input.inventory.drawnLots(
    input.tx,
    input.tenantId,
    { type: 'SalesInvoice', id: input.invoiceId },
    lines.map((line) => line.saleItemId),
  );
  const states = named.length ? await input.inventory.serialStates(input.tx, input.tenantId, named) : [];
  return planReturnLots(lines, drawn, states, input.warehouseId);
}

/**
 * The lots a customer return puts back, decided from what the sale line took
 * out (`drawn`, its lot movements) and the state of the named serials:
 *
 * - serial: a serial recorded on this line must still be sold BY this line
 *   (no later movement: not returned, not resold since). Units the line sold
 *   without a serial on record (a POS without serial scanning) may come back
 *   with no serial, or with their own serial (new, or one the system still
 *   believes is in stock: that only settles the count), up to as many units
 *   as the line has left without a record. A serial that is sold elsewhere,
 *   returned to a supplier or in transit is never accepted here.
 * - batch: goods go back to the batches the line drew, newest draw first. The
 *   line's draws are ordered as the sale took them (FEFO, unallocated last)
 *   and the units earlier returns took back are skipped from the end, so the
 *   same units are never returned twice. Units the line has no record of
 *   (sold before tracking, or over-returned lots) go to the unallocated row.
 */
export function planReturnLots(
  lines: ReturnLine[],
  drawn: DrawnLots[],
  serialRows: SerialRow[],
  warehouseId: string,
): Map<string, StockLots> {
  const result = new Map<string, StockLots>();
  for (const line of lines) {
    const mine = drawn.filter((row) => row.line_id === line.saleItemId);
    result.set(
      line.saleItemId,
      line.tracking === 'serial' ? serialReturn(line, mine, serialRows, warehouseId) : batchReturn(line, mine),
    );
  }
  return result;
}

function serialReturn(line: ReturnLine, drawn: DrawnLots[], serialRows: SerialRow[], warehouseId: string): StockLots {
  const recorded = drawn.filter((row) => row.serial !== null);
  const soldByThisLine = new Map(
    recorded.map((row) => [row.serial!, row.serial_status === 'sold' && row.serial_latest === true]),
  );
  const stateOf = new Map(serialRows.map((row) => [serialKey(line.variantId, row.serial), row]));
  const { serials } = cleanSerials({ serials: line.serials });

  const putBack: string[] = [];
  const refused: string[] = [];
  const withoutRecord: string[] = [];
  for (const serial of serials) {
    if (soldByThisLine.has(serial)) {
      (soldByThisLine.get(serial) ? putBack : refused).push(serial);
      continue;
    }
    withoutRecord.push(serial);
    const row = stateOf.get(serialKey(line.variantId, serial));
    if (!row) putBack.push(serial);
    else if (!(row.status === 'in_stock' && row.warehouse_id === warehouseId)) refused.push(serial);
    // else: the system still counts this unit as in stock (its sale was never scanned), so the return only settles the count.
  }

  // Units this line may take back without a serial on record.
  const returnedRecorded = recorded.filter((row) => !soldByThisLine.get(row.serial!)).length;
  const unrecorded = Prisma.Decimal.max(ZERO, line.soldQty.minus(recorded.length));
  const unrecordedReturned = Prisma.Decimal.max(ZERO, line.returnedBefore.minus(returnedRecorded));
  const allowed = Prisma.Decimal.max(ZERO, unrecorded.minus(unrecordedReturned)).toNumber();

  if (refused.length || withoutRecord.length > allowed) {
    const offending = [...new Set([...refused, ...withoutRecord.slice(allowed)])].slice(0, 20);
    throw new UnprocessableEntityException({
      code: 'RETURN_SERIAL_NOT_SOLD_ON_LINE',
      message: `Serial number(s) were not sold on this invoice line or cannot come back: ${offending.join(', ')}`,
      message_ar: 'رقم تسلسلي لم يُبع في هذا البند من الفاتورة أو سبق إرجاعه أو لا يمكن إرجاعه.',
      serials: offending,
    });
  }
  // Every returned unit is a serial sold here, a named unit without a record, or a unit without any serial.
  const unnamed = Math.max(0, line.qty.toNumber() - serials.length);
  if (withoutRecord.length + unnamed > allowed) {
    throw new BadRequestException({
      code: 'TRACKING_SERIALS_REQUIRED',
      message: `This line was sold with serial numbers: name the serial of each of the ${line.qty} returned unit(s)`,
      message_ar: 'هذا البند بيع بأرقام تسلسلية: أدخل الرقم التسلسلي لكل قطعة مرتجعة.',
      variant_id: line.variantId,
    });
  }
  return { serials: putBack };
}

function batchReturn(line: ReturnLine, drawn: DrawnLots[]): StockLots {
  const draws = drawn
    .filter((row) => row.batch_no !== null)
    .map((row) => ({ batch_no: row.batch_no!, expiry_date: row.expiry_date, created_at: row.batch_created_at!, qty: row.qty }))
    .sort(fefoOrder)
    .reverse();

  const batches: Array<{ batchNo: string; qty: Prisma.Decimal }> = [];
  let skip = line.returnedBefore;
  let need = line.qty;
  for (const draw of draws) {
    if (need.lte(0)) break;
    if (skip.gte(draw.qty)) {
      skip = skip.minus(draw.qty);
      continue;
    }
    const taken = Prisma.Decimal.min(draw.qty.minus(skip), need);
    skip = ZERO;
    need = need.minus(taken);
    batches.push({ batchNo: draw.batch_no, qty: taken });
  }
  if (need.gt(0)) batches.push({ batchNo: UNALLOCATED, qty: need });
  return { batches };
}
