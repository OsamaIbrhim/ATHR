import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cleanSerials, fefoOrder, UNALLOCATED } from '../inventory/inventory-lot-plan';
import type { DrawnLots } from '../inventory/inventory-lot-sql';
import type { StockLots } from '../inventory/inventory.types';

/** One returned sale line of a serial- or batch-tracked variant. */
export type ReturnLine = {
  saleItemId: string;
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
 * The lots a customer return puts back, decided from what the sale line took
 * out (`drawn`, its lot movements):
 *
 * - serial: each named serial must have been sold on this line and still be
 *   sold. A serial the sale never recorded (a POS without serial scanning sold
 *   the unit) is accepted only for as many units as the line has left without
 *   a recorded serial.
 * - batch: goods go back to the batches the line drew, newest draw first. The
 *   line's draws are ordered as the sale took them (FEFO, unallocated last)
 *   and the units earlier returns took back are skipped from the end, so the
 *   same units are never returned twice. Units the line has no record of
 *   (sold before tracking, or over-returned lots) go to the unallocated row.
 */
export function planReturnLots(lines: ReturnLine[], drawn: DrawnLots[]): Map<string, StockLots> {
  const result = new Map<string, StockLots>();
  for (const line of lines) {
    const mine = drawn.filter((row) => row.line_id === line.saleItemId);
    result.set(line.saleItemId, line.tracking === 'serial' ? serialReturn(line, mine) : batchReturn(line, mine));
  }
  return result;
}

function serialReturn(line: ReturnLine, drawn: DrawnLots[]): StockLots {
  const recorded = drawn.filter((row) => row.serial !== null);
  const statusOf = new Map(recorded.map((row) => [row.serial!, row.serial_status]));
  const { serials } = cleanSerials({ serials: line.serials });

  const alreadyBack = serials.filter((serial) => statusOf.has(serial) && statusOf.get(serial) !== 'sold');
  const unknown = serials.filter((serial) => !statusOf.has(serial));
  const returnedRecorded = recorded.filter((row) => row.serial_status !== 'sold').length;
  const withoutSerial = Prisma.Decimal.max(ZERO, line.soldQty.minus(recorded.length));
  const returnedWithoutSerial = Prisma.Decimal.max(ZERO, line.returnedBefore.minus(returnedRecorded));
  const allowedUnknown = Prisma.Decimal.max(ZERO, withoutSerial.minus(returnedWithoutSerial)).toNumber();

  if (alreadyBack.length || unknown.length > allowedUnknown) {
    const offending = [...alreadyBack, ...unknown.slice(allowedUnknown)];
    throw new UnprocessableEntityException({
      code: 'RETURN_SERIAL_NOT_SOLD_ON_LINE',
      message: `Serial number(s) were not sold on this invoice line: ${offending.slice(0, 20).join(', ')}`,
      message_ar: 'رقم تسلسلي لم يُبع في هذا البند من الفاتورة أو سبق إرجاعه.',
      serials: offending.slice(0, 20),
    });
  }
  return { serials };
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
