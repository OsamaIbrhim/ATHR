import type { Prisma } from '@prisma/client';
import type { StockLots } from '../inventory/inventory.types';
import { quantityNumber } from '../common/quantity';

/**
 * The serial numbers and batch a sale line names. Both are optional forever: a
 * POS that predates tracking sends neither, and a sale is never refused over
 * tracking data (the engine records what is missing as a warning).
 */
export type SaleLots = { serials: string[]; batches: Array<{ batchNo: string; qty: Prisma.Decimal }> };

export const noLots = (): SaleLots => ({ serials: [], batches: [] });

/** What one submitted item names (`qty` is the quantity of that item). */
export function lotsOfItem(item: { serials?: string[]; batch_no?: string }, qty: Prisma.Decimal): SaleLots {
  return {
    serials: [...(item.serials ?? [])],
    batches: item.batch_no ? [{ batchNo: item.batch_no, qty }] : [],
  };
}

/** Adds the lots of a duplicate item of the same variant (the sale merges them into one line). */
export function addLots(into: SaleLots, more: SaleLots) {
  into.serials = [...new Set([...into.serials, ...more.serials])];
  for (const batch of more.batches) {
    const same = into.batches.find((existing) => existing.batchNo === batch.batchNo);
    if (same) same.qty = same.qty.plus(batch.qty);
    else into.batches.push({ ...batch });
  }
}

/**
 * The lots part of a line's command fingerprint: nothing at all when the line
 * names none, so a payload from a POS without tracking hashes exactly as it
 * always did (a replayed outbox item must keep matching its stored invoice).
 */
export function lotsFingerprint(lots: SaleLots) {
  return {
    ...(lots.serials.length ? { serials: [...lots.serials].sort() } : {}),
    ...(lots.batches.length
      ? {
          batches: lots.batches
            .map((batch) => ({ batch_no: batch.batchNo, qty: quantityNumber(batch.qty) }))
            .sort((left, right) => left.batch_no.localeCompare(right.batch_no)),
        }
      : {}),
  };
}

/** The engine's view of a line's lots; undefined when the line names none. */
export function stockLots(lots: SaleLots): StockLots | undefined {
  if (!lots.serials.length && !lots.batches.length) return undefined;
  return {
    ...(lots.serials.length ? { serials: lots.serials } : {}),
    ...(lots.batches.length ? { batches: lots.batches } : {}),
  };
}
