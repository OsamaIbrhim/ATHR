import { Prisma } from '@prisma/client';
import {
  normalizeExpiry,
  planBatches,
  planSerials,
  serialOutStatus,
  type BatchRow,
  type SerialRow,
} from './inventory-lot-plan';

const D = (value: number | string) => new Prisma.Decimal(value);
const WAREHOUSE = 'warehouse-1';
const VARIANT = 'variant-1';
const MOVEMENT = 'movement-1';

const serialLine = (delta: number, serials?: string[]) => ({
  variantId: VARIANT,
  movementId: MOVEMENT,
  delta: D(delta),
  lots: serials ? { serials } : undefined,
});
const serialRow = (serial: string, status: SerialRow['status'], warehouse: string | null = null): SerialRow => ({
  variant_id: VARIANT,
  serial,
  status,
  warehouse_id: status === 'in_stock' ? (warehouse ?? WAREHOUSE) : null,
});
const plan = (over: Partial<Parameters<typeof planSerials>[0]> & { lines: Parameters<typeof planSerials>[0]['lines'] }) =>
  planSerials({ rows: [], warehouseId: WAREHOUSE, movementType: 'sale', tolerant: true, ...over });

describe('planSerials', () => {
  describe('coming into stock (always strict)', () => {
    it('needs exactly one distinct serial per unit', () => {
      for (const serials of [undefined, ['A'], ['A', 'A', 'B'], ['A', 'B', 'C']]) {
        expect(() => plan({ lines: [serialLine(2, serials)] })).toThrow(
          expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_SERIALS_REQUIRED' }) }),
        );
      }
    });

    it('registers each serial as in stock and logs +1 for it', () => {
      const { writes } = plan({ lines: [serialLine(2, [' A ', 'B'])] });
      expect(writes).toEqual([
        expect.objectContaining({ serial: 'A', status: 'in_stock', delta: 1, movementId: MOVEMENT }),
        expect.objectContaining({ serial: 'B', status: 'in_stock', delta: 1 }),
      ]);
    });

    it('refuses a serial that is still in stock or in transit', () => {
      for (const held of [serialRow('A', 'in_stock'), serialRow('A', 'in_transit')]) {
        expect(() => plan({ lines: [serialLine(1, ['A'])], rows: [held] })).toThrow(
          expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_SERIAL_ALREADY_IN_STOCK', serials: ['A'] }) }),
        );
      }
    });

    it('takes back a serial that was sold or returned to the supplier', () => {
      for (const gone of [serialRow('A', 'sold'), serialRow('A', 'returned_to_supplier')]) {
        expect(plan({ lines: [serialLine(1, ['A'])], rows: [gone] }).writes).toHaveLength(1);
      }
    });
  });

  describe('leaving stock through an online document (strict)', () => {
    const strict = (serials: string[] | undefined, rows: SerialRow[] = []) =>
      plan({ lines: [serialLine(-2, serials)], rows, tolerant: false, movementType: 'reversal' });

    it('needs the serials and each must be in stock in this warehouse', () => {
      expect(() => strict(['A'], [serialRow('A', 'in_stock')])).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_SERIALS_REQUIRED' }) }),
      );
      expect(() => strict(['A', 'B'], [serialRow('A', 'in_stock')])).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_SERIAL_NOT_IN_STOCK', serials: ['B'] }) }),
      );
      expect(() => strict(['A', 'B'], [serialRow('A', 'in_stock'), serialRow('B', 'in_stock', 'elsewhere')])).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ serials: ['B'] }) }),
      );
    });

    it('sends the serials back to the supplier', () => {
      const { writes, warnings } = strict(['A', 'B'], [serialRow('A', 'in_stock'), serialRow('B', 'in_stock')]);
      expect(writes.map((write) => [write.serial, write.status, write.delta])).toEqual([
        ['A', 'returned_to_supplier', -1],
        ['B', 'returned_to_supplier', -1],
      ]);
      expect(warnings.size).toBe(0);
    });
  });

  describe('a sale (accepted first, never refused)', () => {
    it('records a POS 1.6.0 sale without serials with SERIAL_NOT_CAPTURED and touches no serial', () => {
      const { writes, warnings } = plan({ lines: [serialLine(-2)] });
      expect(writes).toEqual([]);
      expect([...warnings.get(VARIANT)!]).toEqual(['SERIAL_NOT_CAPTURED']);
    });

    it('marks known serials sold and flags only the missing ones', () => {
      const { writes, warnings } = plan({
        lines: [serialLine(-2, ['A'])],
        rows: [serialRow('A', 'in_stock')],
      });
      expect(writes).toEqual([expect.objectContaining({ serial: 'A', status: 'sold', delta: -1 })]);
      expect([...warnings.get(VARIANT)!]).toEqual(['SERIAL_NOT_CAPTURED']);
    });

    it('accepts an unknown or unavailable serial as sold with SERIAL_NOT_IN_STOCK', () => {
      const { writes, warnings } = plan({
        lines: [serialLine(-3, ['NEW', 'GONE', 'ELSEWHERE'])],
        rows: [serialRow('GONE', 'sold'), serialRow('ELSEWHERE', 'in_stock', 'other-warehouse')],
      });
      expect(writes.map((write) => write.serial)).toEqual(['NEW', 'GONE', 'ELSEWHERE']);
      expect(writes.every((write) => write.status === 'sold' && write.delta === -1)).toBe(true);
      expect([...warnings.get(VARIANT)!]).toEqual(['SERIAL_NOT_IN_STOCK']);
    });

    it('ignores serials beyond the quantity sold', () => {
      const { writes } = plan({ lines: [serialLine(-1, ['A', 'B'])], rows: [serialRow('A', 'in_stock'), serialRow('B', 'in_stock')] });
      expect(writes.map((write) => write.serial)).toEqual(['A']);
    });
  });

  it('knows where a serial goes by what moved it, and refuses other movements', () => {
    expect(serialOutStatus('sale')).toBe('sold');
    expect(serialOutStatus('reversal')).toBe('returned_to_supplier');
    expect(() => serialOutStatus('adjustment')).toThrow();
  });
});

// --- batches ------------------------------------------------------------------

let created = 0;
const batch = (batchNo: string, qty: number, expiry: string | null = null): BatchRow => ({
  variant_id: VARIANT,
  batch_no: batchNo,
  expiry_date: expiry ? new Date(`${expiry}T00:00:00.000Z`) : null,
  qty: D(qty),
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, (created += 1))),
});
const batchLine = (delta: number, batches?: Array<{ batchNo: string; qty: number; expiryDate?: string }>) => ({
  variantId: VARIANT,
  movementId: MOVEMENT,
  delta: D(delta),
  lots: batches ? { batches } : undefined,
});
const deltasOf = (changes: ReturnType<typeof planBatches>['changes']) =>
  Object.fromEntries(changes.map((change) => [change.batchNo || '(unallocated)', change.delta.toNumber()]));

describe('planBatches', () => {
  describe('coming into stock', () => {
    it('needs batch numbers adding up to the quantity', () => {
      for (const batches of [undefined, [{ batchNo: 'A', qty: 3 }], [{ batchNo: 'A', qty: 6 }]]) {
        expect(() => planBatches({ lines: [batchLine(5, batches)], rows: [], tolerant: true })).toThrow(
          expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_BATCHES_REQUIRED' }) }),
        );
      }
    });

    it('creates or tops up batches with their expiry, merging a batch listed twice', () => {
      const { changes } = planBatches({
        lines: [batchLine(5, [{ batchNo: 'A', qty: 2, expiryDate: '2027-03-01' }, { batchNo: 'A', qty: 3 }])],
        rows: [],
        tolerant: true,
      });
      expect(changes).toEqual([expect.objectContaining({ batchNo: 'A', expiryDate: '2027-03-01', delta: D(5) })]);
    });

    it('refuses two expiry dates for one batch and impossible dates', () => {
      expect(() =>
        planBatches({
          lines: [batchLine(2, [{ batchNo: 'A', qty: 1, expiryDate: '2027-03-01' }, { batchNo: 'A', qty: 1, expiryDate: '2027-04-01' }])],
          rows: [],
          tolerant: true,
        }),
      ).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_EXPIRY_CONFLICT' }) }));
      expect(() => normalizeExpiry('2027-02-30')).toThrow();
      expect(normalizeExpiry('2027-02-28T10:00:00Z')).toBe('2027-02-28');
      expect(normalizeExpiry('')).toBeNull();
    });

    it('settles a negative unallocated row first: sold units are charged to the received batch', () => {
      const { changes } = planBatches({
        lines: [batchLine(10, [{ batchNo: 'A', qty: 10 }])],
        rows: [batch('', -3)],
        tolerant: true,
      });
      // 10 received: 3 were already sold, so the shelf holds 7 and the unallocated row returns to 0.
      expect(deltasOf(changes)).toEqual({ A: 7, '(unallocated)': 3 });
      // The lot deltas of one movement add up to the stock change.
      expect(changes.reduce((sum, change) => sum.plus(change.delta), D(0)).toNumber()).toBe(10);
    });

    it('settles only what was owed and spreads a deficit over the batches received in order', () => {
      const { changes } = planBatches({
        lines: [batchLine(6, [{ batchNo: 'A', qty: 2 }, { batchNo: 'B', qty: 4 }])],
        rows: [batch('', -3)],
        tolerant: true,
      });
      expect(deltasOf(changes)).toEqual({ A: 0, '(unallocated)': 3, B: 3 });
    });

    it('does not touch a positive unallocated row', () => {
      const { changes } = planBatches({ lines: [batchLine(4, [{ batchNo: 'A', qty: 4 }])], rows: [batch('', 2)], tolerant: true });
      expect(deltasOf(changes)).toEqual({ A: 4 });
    });
  });

  describe('a sale (FEFO, never refused)', () => {
    const sell = (qty: number, rows: BatchRow[], batches?: Array<{ batchNo: string; qty: number }>) =>
      planBatches({ lines: [batchLine(-qty, batches)], rows, tolerant: true });

    it('takes the soonest expiry first, then undated batches, oldest first', () => {
      const rows = [batch('LATE', 5, '2027-01-01'), batch('SOON', 5, '2026-06-01'), batch('UNDATED', 5)];
      expect(deltasOf(sell(8, rows).changes)).toEqual({ SOON: -5, LATE: -3 });
      expect(deltasOf(sell(12, rows).changes)).toEqual({ SOON: -5, LATE: -5, UNDATED: -2 });
    });

    it('draws on a positive unallocated row only after every real batch', () => {
      const rows = [batch('', 4), batch('A', 2, '2026-06-01')];
      expect(deltasOf(sell(5, rows).changes)).toEqual({ A: -2, '(unallocated)': -3 });
    });

    it('sends the shortfall to the unallocated row with a warning', () => {
      const { changes, warnings } = sell(7, [batch('A', 3, '2026-06-01')]);
      expect(deltasOf(changes)).toEqual({ A: -3, '(unallocated)': -4 });
      expect([...warnings.get(VARIANT)!]).toEqual(['BATCH_UNALLOCATED']);
    });

    it('goes wholly to the unallocated row when there is no batch at all', () => {
      const { changes, warnings } = sell(2, []);
      expect(deltasOf(changes)).toEqual({ '(unallocated)': -2 });
      expect(warnings.get(VARIANT)?.has('BATCH_UNALLOCATED')).toBe(true);
    });

    it('does not count a negative unallocated row as stock', () => {
      const { changes } = sell(2, [batch('', -5), batch('A', 4)]);
      expect(deltasOf(changes)).toEqual({ A: -2 });
    });

    it('draws on the named batch first and covers the rest by FEFO of the others', () => {
      const rows = [batch('SOON', 5, '2026-06-01'), batch('NAMED', 3, '2028-01-01')];
      expect(deltasOf(sell(5, rows, [{ batchNo: 'NAMED', qty: 5 }]).changes)).toEqual({ NAMED: -3, SOON: -2 });
    });
  });

  describe('leaving stock through an online document (strict)', () => {
    const remove = (qty: number, rows: BatchRow[], batches?: Array<{ batchNo: string; qty: number }>) =>
      planBatches({ lines: [batchLine(-qty, batches)], rows, tolerant: false });

    it('needs the batch numbers', () => {
      expect(() => remove(2, [batch('A', 5)])).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_BATCHES_REQUIRED' }) }),
      );
    });

    it('takes exactly the named batch and refuses when it holds too little', () => {
      expect(deltasOf(remove(2, [batch('A', 5), batch('B', 5)], [{ batchNo: 'B', qty: 2 }]).changes)).toEqual({ B: -2 });
      expect(() => remove(4, [batch('A', 9), batch('B', 3)], [{ batchNo: 'B', qty: 4 }])).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_BATCH_INSUFFICIENT', batch_no: 'B' }) }),
      );
      expect(() => remove(2, [batch('A', 9)], [{ batchNo: 'GHOST', qty: 2 }])).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'TRACKING_BATCH_INSUFFICIENT' }) }),
      );
    });
  });
});
