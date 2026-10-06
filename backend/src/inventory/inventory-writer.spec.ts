import { Prisma, type TrackingMode } from '@prisma/client';
import { applyStock } from './inventory-writer';
import type { ApplyStockCommand } from './inventory.types';

// The engine against real Postgres is proven by scripts/verify-inventory-engine.cjs.
// These cases pin the SHAPE of what it sends: which statements, in which
// number, with which locks. An untracked command must cost exactly what it cost
// before tracking existed.

const D = (value: number | string) => new Prisma.Decimal(value);
const TENANT = '00000000-0000-4000-8000-000000000001';
const WAREHOUSE = '00000000-0000-4000-8000-000000000002';
const VARIANT_A = '00000000-0000-4000-8000-00000000000a';
const VARIANT_B = '00000000-0000-4000-8000-00000000000b';
const MOVEMENT = (variantId: string) => `movement-of-${variantId}`;

type Statement = { kind: 'query' | 'execute'; sql: string };

/** A transaction double that records every statement and answers the few reads the engine makes. */
function fakeTx(options: {
  tracking?: Record<string, TrackingMode>;
  /** Ledger rows the insert reports as inserted; an empty list = the command was applied before. */
  inserted?: 'all' | 'none';
  batchRows?: unknown[];
  replayRows?: unknown[];
}) {
  const statements: Statement[] = [];
  const stockRow = (variantId: string) => ({
    variant_id: variantId,
    qty_on_hand: D(10),
    qty_reserved: D(0),
    avg_cost: D(5),
    tracking: options.tracking?.[variantId] ?? 'none',
  });
  const text = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ');
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = text(strings);
      statements.push({ kind: 'query', sql });
      if (sql.includes('FROM "InventoryStock"') && sql.includes('FOR UPDATE')) {
        const ids = values.find((value): value is string[] => Array.isArray(value) && value.length > 0) ?? [];
        return ids.map(stockRow);
      }
      if (sql.includes('INSERT INTO "InventoryMovement"')) {
        if (options.inserted === 'none') return [];
        const ids = values.find((value): value is string[] => Array.isArray(value) && value.length > 0) ?? [];
        return ids.map((variant_id) => ({ id: MOVEMENT(variant_id), variant_id }));
      }
      if (sql.includes('FROM "InventoryMovement"')) return options.replayRows ?? [];
      if (sql.includes('FROM "InventoryBatch"')) return options.batchRows ?? [];
      if (sql.includes('INSERT INTO "InventorySerial"')) return (values[0] as string[]).map((id) => ({ id }));
      return [];
    }),
    $executeRaw: jest.fn(async (strings: TemplateStringsArray) => {
      statements.push({ kind: 'execute', sql: text(strings) });
      return 1;
    }),
  };
  return { tx: tx as any, statements };
}

const command = (over: Partial<ApplyStockCommand>): ApplyStockCommand => ({
  tenantId: TENANT,
  warehouseId: WAREHOUSE,
  occurredAt: new Date('2026-10-01T10:00:00Z'),
  type: 'sale',
  reference: { type: 'SalesInvoice', id: 'invoice-1' },
  idempotencyKey: 'sale:1',
  allowNegative: true,
  lines: [{ variantId: VARIANT_A, qtyDelta: -1 }],
  ...over,
});

const touchesLots = (statement: Statement) => /"Inventory(Batch|Serial|LotMovement)"/.test(statement.sql);

describe('inventory writer statements', () => {
  it('locks only the stock rows: the variant is joined for its tracking mode but never locked', async () => {
    const { tx, statements } = fakeTx({});
    await applyStock(tx, command({}));

    const lock = statements.find((statement) => statement.sql.includes('FOR UPDATE'))!;
    expect(lock.sql).toContain('JOIN "ProductVariant" v');
    expect(lock.sql).toContain('v."tracking"');
    expect(lock.sql).toContain('FOR UPDATE OF "InventoryStock"');
    // Locking ProductVariant would serialise every branch's sales of one item.
    expect(lock.sql).not.toMatch(/FOR UPDATE OF v\b/);
    expect(lock.sql).not.toContain('FOR UPDATE OF "ProductVariant"');
    expect(lock.sql).not.toMatch(/FOR UPDATE(?! OF)/);
  });

  it('runs an untracked command in the same three statements as before tracking existed', async () => {
    const { tx, statements } = fakeTx({});
    await applyStock(
      tx,
      command({
        lines: [
          { variantId: VARIANT_A, qtyDelta: -1 },
          { variantId: VARIANT_B, qtyDelta: -2 },
        ],
      }),
    );

    expect(statements.map((statement) => statement.kind)).toEqual(['query', 'query', 'execute']);
    expect(statements.some(touchesLots)).toBe(false);
  });

  it('ignores lots sent for a variant that is not tracked', async () => {
    const { tx, statements } = fakeTx({});
    await applyStock(tx, command({ lines: [{ variantId: VARIANT_A, qtyDelta: -1, lots: { serials: ['X'] } }] }));
    expect(statements).toHaveLength(3);
  });

  it('adds one lock-read and one write for a batch-tracked sale, however many lines', async () => {
    const { tx, statements } = fakeTx({ tracking: { [VARIANT_A]: 'batch', [VARIANT_B]: 'batch' } });
    await applyStock(
      tx,
      command({
        lines: [
          { variantId: VARIANT_A, qtyDelta: -1 },
          { variantId: VARIANT_B, qtyDelta: -2 },
        ],
      }),
    );

    expect(statements).toHaveLength(5);
    const lots = statements.filter(touchesLots);
    expect(lots.map((statement) => statement.kind)).toEqual(['query', 'execute']);
    expect(lots[0].sql).toContain('FOR UPDATE');
    expect(lots[1].sql).toContain('INSERT INTO "InventoryLotMovement"');
  });

  it('adds serial statements only when serials are named: a POS 1.6.0 sale of a serial item adds none', async () => {
    const withoutSerials = fakeTx({ tracking: { [VARIANT_A]: 'serial' } });
    const [result] = await applyStock(withoutSerials.tx, command({}));
    expect(withoutSerials.statements).toHaveLength(3);
    expect(result.warnings).toEqual(['SERIAL_NOT_CAPTURED']);

    const withSerials = fakeTx({ tracking: { [VARIANT_A]: 'serial' } });
    await applyStock(withSerials.tx, command({ lines: [{ variantId: VARIANT_A, qtyDelta: -1, lots: { serials: ['S1'] } }] }));
    expect(withSerials.statements).toHaveLength(5);
  });

  it('does not re-apply lots when the command is replayed', async () => {
    const { tx, statements } = fakeTx({
      tracking: { [VARIANT_A]: 'batch' },
      inserted: 'none',
      replayRows: [
        { variant_id: VARIANT_A, warehouse_id: WAREHOUSE, on_hand_delta: D(-1), on_hand_after: D(9), reserved_after: D(0) },
      ],
    });
    const [result] = await applyStock(tx, command({}));

    expect(result.qtyAfter.toNumber()).toBe(9);
    expect(statements.some(touchesLots)).toBe(false);
  });

  it('refuses tracked lines on a transfer before writing anything', async () => {
    const { tx, statements } = fakeTx({ tracking: { [VARIANT_A]: 'batch' } });
    await expect(applyStock(tx, command({ type: 'transfer_out', allowNegative: false }))).rejects.toMatchObject({
      response: { code: 'TRACKED_TRANSFER_NOT_SUPPORTED' },
    });
    expect(statements.filter((statement) => statement.sql.includes('INSERT'))).toEqual([]);
  });

  it('refuses stock coming in for a tracked variant without its serials or batches', async () => {
    const serial = fakeTx({ tracking: { [VARIANT_A]: 'serial' } });
    await expect(
      applyStock(serial.tx, command({ type: 'purchase_receipt', lines: [{ variantId: VARIANT_A, qtyDelta: 2 }] })),
    ).rejects.toMatchObject({ response: { code: 'TRACKING_SERIALS_REQUIRED' } });

    const batch = fakeTx({ tracking: { [VARIANT_A]: 'batch' } });
    await expect(
      applyStock(batch.tx, command({ type: 'purchase_receipt', lines: [{ variantId: VARIANT_A, qtyDelta: 2 }] })),
    ).rejects.toMatchObject({ response: { code: 'TRACKING_BATCHES_REQUIRED' } });
  });

  it('reports the unallocated shortfall of a batch sale as a warning on the line', async () => {
    const { tx } = fakeTx({ tracking: { [VARIANT_A]: 'batch' }, batchRows: [] });
    const [result] = await applyStock(tx, command({}));
    expect(result.warnings).toEqual(['BATCH_UNALLOCATED']);
  });
});
