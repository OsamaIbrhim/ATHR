import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type SerialStatus } from '@prisma/client';
import { quantity } from '../common/quantity';
import type { StockLots, TrackingWarning } from './inventory.types';

/**
 * Decides, without touching the database, what a tracked command does to
 * serials and batches (docs/design/W2b-tracking.md section 3). The caller
 * reads the affected rows (locked), hands them in, and writes the plan back in
 * one statement per kind.
 *
 * Inbound lines are always strict. Outbound lines are strict for online
 * admin documents and tolerant (`tolerant`) for the acceptance-first sale:
 * a sale is recorded whatever the tracking data looks like, with a warning.
 */

/** batch_no of the single "unallocated" row of a (warehouse, variant). */
export const UNALLOCATED = '';

const ZERO = new Prisma.Decimal(0);
const MAX_SHOWN = 20;

type Warnings = Map<string, Set<TrackingWarning>>;

const bad = (code: string, message: string, message_ar: string, extra: object = {}) =>
  new BadRequestException({ code, message, message_ar, ...extra });
const conflict = (code: string, message: string, message_ar: string, extra: object = {}) =>
  new ConflictException({ code, message, message_ar, ...extra });

function warn(warnings: Warnings, variantId: string, code: TrackingWarning) {
  const set = warnings.get(variantId) ?? new Set<TrackingWarning>();
  set.add(code);
  warnings.set(variantId, set);
}

// --- serials ------------------------------------------------------------------

export type SerialLine = { variantId: string; movementId: string; delta: Prisma.Decimal; lots?: StockLots };
export type SerialRow = { variant_id: string; serial: string; status: SerialStatus; warehouse_id: string | null };
export type SerialWrite = {
  variantId: string;
  movementId: string;
  serial: string;
  /** The status the serial ends in. */
  status: SerialStatus;
  /** +1 back into stock, -1 out of it. */
  delta: 1 | -1;
};

export const serialKey = (variantId: string, serial: string) => `${variantId}\u0000${serial}`;

/** Trimmed, non-empty serials; `duplicates` says whether the caller sent one twice. */
export function cleanSerials(lots: StockLots | undefined) {
  const trimmed = (lots?.serials ?? []).map((serial) => String(serial).trim()).filter(Boolean);
  const serials = [...new Set(trimmed)];
  return { serials, duplicates: serials.length !== trimmed.length };
}

/** Where a serial that leaves stock ends up, by what moved it. */
export function serialOutStatus(movementType: string): SerialStatus {
  if (movementType === 'sale') return 'sold';
  if (movementType === 'reversal') return 'returned_to_supplier';
  throw bad(
    'TRACKING_MOVEMENT_NOT_SUPPORTED',
    `Serial-tracked stock cannot leave through a ${movementType} movement`,
    'لا يمكن إخراج صنف متتبع بالسيريال بهذا النوع من الحركات.',
  );
}

const serialsRequired = (variantId: string, wanted: Prisma.Decimal) =>
  bad(
    'TRACKING_SERIALS_REQUIRED',
    `Serial-tracked variant ${variantId} needs exactly ${wanted} distinct serial number(s)`,
    'الصنف متتبع بالرقم التسلسلي: أدخل رقمًا تسلسليًا مختلفًا لكل قطعة.',
    { variant_id: variantId },
  );

export function planSerials(input: {
  lines: SerialLine[];
  rows: SerialRow[];
  warehouseId: string;
  movementType: string;
  tolerant: boolean;
}) {
  const known = new Map(input.rows.map((row) => [serialKey(row.variant_id, row.serial), row]));
  const inStockHere = (variantId: string, serial: string) => {
    const row = known.get(serialKey(variantId, serial));
    return !!row && row.status === 'in_stock' && row.warehouse_id === input.warehouseId;
  };
  const writes: SerialWrite[] = [];
  const warnings: Warnings = new Map();

  for (const line of input.lines) {
    const { serials, duplicates } = cleanSerials(line.lots);
    const wanted = line.delta.abs();
    // Goods coming back from a customer may name fewer serials than units: the
    // rest were sold without a serial on record (see the sales return).
    const comesBack = input.movementType === 'return';
    const exact =
      wanted.isInteger() &&
      (comesBack && line.delta.gt(0) ? serials.length <= wanted.toNumber() : serials.length === wanted.toNumber()) &&
      !duplicates;
    const write = (serial: string, status: SerialStatus, delta: 1 | -1) =>
      writes.push({ variantId: line.variantId, movementId: line.movementId, serial, status, delta });

    if (line.delta.gt(0)) {
      if (!exact) throw serialsRequired(line.variantId, wanted);
      // A serial can come back only from a state that left the stock.
      const held = serials.filter((serial) => {
        const row = known.get(serialKey(line.variantId, serial));
        return row && row.status !== 'sold' && row.status !== 'returned_to_supplier';
      });
      if (held.length) {
        throw conflict(
          'TRACKING_SERIAL_ALREADY_IN_STOCK',
          `Serial number(s) already in stock: ${held.slice(0, MAX_SHOWN).join(', ')}`,
          'رقم تسلسلي مسجل بالفعل في المخزون.',
          { variant_id: line.variantId, serials: held.slice(0, MAX_SHOWN) },
        );
      }
      for (const serial of serials) write(serial, 'in_stock', 1);
      continue;
    }

    const status = serialOutStatus(input.movementType);
    if (!input.tolerant) {
      if (!exact) throw serialsRequired(line.variantId, wanted);
      const missing = serials.filter((serial) => !inStockHere(line.variantId, serial));
      if (missing.length) {
        throw conflict(
          'TRACKING_SERIAL_NOT_IN_STOCK',
          `Serial number(s) not in stock here: ${missing.slice(0, MAX_SHOWN).join(', ')}`,
          'رقم تسلسلي غير موجود في مخزون هذا الفرع.',
          { variant_id: line.variantId, serials: missing.slice(0, MAX_SHOWN) },
        );
      }
    }

    // Tolerant: serials beyond the quantity are ignored; every serial that is
    // named is recorded as leaving, known or not.
    const taken = serials.slice(0, Math.ceil(wanted.toNumber()));
    for (const serial of taken) {
      if (!inStockHere(line.variantId, serial)) warn(warnings, line.variantId, 'SERIAL_NOT_IN_STOCK');
      write(serial, status, -1);
    }
    if (taken.length < wanted.toNumber()) warn(warnings, line.variantId, 'SERIAL_NOT_CAPTURED');
  }
  return { writes, warnings };
}

// --- batches ------------------------------------------------------------------

export type BatchLine = { variantId: string; movementId: string; delta: Prisma.Decimal; lots?: StockLots };
export type BatchRow = {
  variant_id: string;
  batch_no: string;
  expiry_date: Date | null;
  qty: Prisma.Decimal;
  created_at: Date;
};
export type BatchChange = {
  variantId: string;
  movementId: string;
  batchNo: string;
  /** YYYY-MM-DD; an existing batch keeps the expiry it has. */
  expiryDate: string | null;
  delta: Prisma.Decimal;
};

/** YYYY-MM-DD of a date-ish string, null when absent; throws for anything that is not a calendar date. */
export function normalizeExpiry(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  const day = String(value).slice(0, 10);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw bad('TRACKING_EXPIRY_INVALID', `Invalid expiry date: ${value}`, 'تاريخ الصلاحية غير صحيح.');
  }
  return day;
}

/** The requested batches of a line, merged per batch number. */
function requestedBatches(line: BatchLine) {
  const merged = new Map<string, { qty: Prisma.Decimal; expiry: string | null }>();
  for (const batch of line.lots?.batches ?? []) {
    const batchNo = String(batch.batchNo ?? '').trim();
    if (batchNo.length > 100) {
      throw bad('TRACKING_BATCH_NO_INVALID', `Batch number is too long: ${batchNo.slice(0, 20)}...`, 'رقم الدفعة أطول من المسموح.');
    }
    let qty: Prisma.Decimal;
    try {
      qty = quantity(batch.qty);
    } catch {
      throw bad('TRACKING_BATCH_QTY_INVALID', `Invalid batch quantity for ${batchNo}`, 'كمية الدفعة غير صحيحة.');
    }
    if (!qty.gt(0)) {
      throw bad('TRACKING_BATCH_QTY_INVALID', `Batch quantity must be positive (${batchNo})`, 'كمية الدفعة يجب أن تكون أكبر من صفر.');
    }
    const expiry = normalizeExpiry(batch.expiryDate);
    const current = merged.get(batchNo);
    if (current && current.expiry && expiry && current.expiry !== expiry) {
      throw bad('TRACKING_EXPIRY_CONFLICT', `Batch ${batchNo} is listed with two expiry dates`, 'نفس الدفعة مكتوبة بتاريخي صلاحية مختلفين.');
    }
    merged.set(batchNo, { qty: (current?.qty ?? ZERO).plus(qty), expiry: current?.expiry ?? expiry });
  }
  return merged;
}

/** Oldest expiry first, undated after dated, the unallocated row last of all. */
export function fefoOrder(
  left: Pick<BatchRow, 'batch_no' | 'expiry_date' | 'created_at'>,
  right: Pick<BatchRow, 'batch_no' | 'expiry_date' | 'created_at'>,
) {
  const unallocated = Number(left.batch_no === UNALLOCATED) - Number(right.batch_no === UNALLOCATED);
  if (unallocated) return unallocated;
  const leftDate = left.expiry_date?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightDate = right.expiry_date?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
  return left.created_at.getTime() - right.created_at.getTime() || left.batch_no.localeCompare(right.batch_no);
}

const batchesRequired = (variantId: string, total: Prisma.Decimal) =>
  bad(
    'TRACKING_BATCHES_REQUIRED',
    `Batch-tracked variant ${variantId} needs batch numbers adding up to ${total}`,
    'الصنف متتبع بالدفعات: أدخل رقم الدفعة والكمية لكل دفعة.',
    { variant_id: variantId },
  );

/**
 * `settleDeficit`: a receipt first pays off a negative unallocated row (the
 * units were already sold without a batch). Goods coming back from a customer
 * do not: they return to the batch they were sold from.
 */
export function planBatches(input: { lines: BatchLine[]; rows: BatchRow[]; tolerant: boolean; settleDeficit?: boolean }) {
  const changes: BatchChange[] = [];
  const warnings: Warnings = new Map();

  for (const line of input.lines) {
    const rows = input.rows.filter((row) => row.variant_id === line.variantId);
    const requested = requestedBatches(line);
    const totalRequested = [...requested.values()].reduce((sum, batch) => sum.plus(batch.qty), ZERO);
    const deltas = new Map<string, { delta: Prisma.Decimal; expiry: string | null }>();
    const add = (batchNo: string, delta: Prisma.Decimal, expiry: string | null = null) => {
      const current = deltas.get(batchNo);
      deltas.set(batchNo, { delta: (current?.delta ?? ZERO).plus(delta), expiry: current?.expiry ?? expiry });
    };

    if (line.delta.gt(0)) {
      if (!requested.size || !totalRequested.equals(line.delta)) throw batchesRequired(line.variantId, line.delta);
      // Units already sold without a batch (negative unallocated row) belong
      // to the first batch received, so the deficit is settled, not carried.
      const unallocated = rows.find((row) => row.batch_no === UNALLOCATED)?.qty ?? ZERO;
      let deficit = unallocated.isNegative() && input.settleDeficit !== false ? unallocated.negated() : ZERO;
      for (const [batchNo, batch] of requested) {
        if (batchNo === UNALLOCATED) {
          add(UNALLOCATED, batch.qty);
          continue;
        }
        const settled = Prisma.Decimal.min(batch.qty, deficit);
        deficit = deficit.minus(settled);
        if (settled.gt(0)) add(UNALLOCATED, settled);
        add(batchNo, batch.qty.minus(settled), batch.expiry);
      }
    } else {
      const wanted = line.delta.negated();
      if (requested.has(UNALLOCATED)) {
        throw bad('TRACKING_BATCH_NO_INVALID', 'A batch number is required', 'رقم الدفعة مطلوب.');
      }
      if (!input.tolerant && (!requested.size || !totalRequested.equals(wanted))) {
        throw batchesRequired(line.variantId, wanted);
      }

      const left = new Map(rows.map((row) => [row.batch_no, row.qty.gt(0) ? row.qty : ZERO]));
      let need = wanted;
      const take = (batchNo: string, want: Prisma.Decimal) => {
        const taken = Prisma.Decimal.min(want, left.get(batchNo) ?? ZERO);
        if (taken.gt(0)) {
          left.set(batchNo, (left.get(batchNo) ?? ZERO).minus(taken));
          add(batchNo, taken.negated());
          need = need.minus(taken);
        }
        return taken;
      };
      for (const [batchNo, batch] of requested) {
        const want = Prisma.Decimal.min(batch.qty, need);
        if (!take(batchNo, want).equals(want) && !input.tolerant) {
          throw conflict(
            'TRACKING_BATCH_INSUFFICIENT',
            `Batch ${batchNo} does not hold ${want} of variant ${line.variantId}`,
            'الكمية المتاحة في هذه الدفعة غير كافية.',
            { variant_id: line.variantId, batch_no: batchNo },
          );
        }
      }
      // What was not named (or the named batches could not cover) draws on
      // the other batches, oldest expiry first.
      const others = rows.filter((row) => !requested.has(row.batch_no) && row.qty.gt(0)).sort(fefoOrder);
      for (const row of others) {
        if (need.lte(0)) break;
        take(row.batch_no, need);
      }
      if (need.gt(0)) {
        if (!input.tolerant) {
          throw conflict(
            'TRACKING_BATCH_INSUFFICIENT',
            `Not enough batch stock for variant ${line.variantId}`,
            'الكمية المتاحة في الدفعات غير كافية.',
            { variant_id: line.variantId },
          );
        }
        add(UNALLOCATED, need.negated());
        warn(warnings, line.variantId, 'BATCH_UNALLOCATED');
      }
    }

    for (const [batchNo, { delta, expiry }] of deltas) {
      changes.push({ variantId: line.variantId, movementId: line.movementId, batchNo, expiryDate: expiry, delta });
    }
  }
  return { changes, warnings };
}
