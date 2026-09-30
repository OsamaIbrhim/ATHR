import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { postOpeningBalance } from './opening-balance';
import type { StockVariant } from '../inventory/inventory-variants';

const D = (value: number | string) => new Prisma.Decimal(value);
const variant = (id: string, extra: Partial<StockVariant> = {}): StockVariant => ({
  id,
  sku: `SKU-${id}`,
  item_type: 'stocked',
  tracking: 'none',
  cost_price: D(12),
  precision: 0,
  ...extra,
});

/** A transaction whose prior-movement reads come from `movementReads` (first read, second read, ...). */
function setup(movementReads: string[][] = [[], []]) {
  const reads = [...movementReads];
  const tx: any = {
    $queryRaw: jest.fn(async () => (reads.shift() ?? []).map((variant_id) => ({ variant_id }))),
  };
  const apply = jest.fn(async (_tx: unknown, command: any) =>
    command.lines.map((line: any) => ({
      variantId: line.variantId,
      qtyBefore: D(0),
      qtyAfter: D(line.qtyDelta),
      reserved: D(0),
      avgCostBefore: D(0),
      avgCost: D(line.unitCost),
    })),
  );
  const input = (lines: any[], variants: StockVariant[], extra: Record<string, unknown> = {}) => ({
    tenantId: 'tenant-1',
    warehouseId: 'warehouse-1',
    actorId: 'user-1',
    idempotencyKey: 'opening:key-1',
    referenceId: 'ref-1',
    variants: new Map(variants.map((v) => [v.id, v])),
    lines: lines.map((line, index) => ({ index, unitCost: null, ...line })),
    ...extra,
  });
  return { tx, apply, input, run: (i: ReturnType<typeof input>) => postOpeningBalance({ apply } as any, tx, i as any) };
}

describe('postOpeningBalance', () => {
  it('posts every allowed line as one opening_balance command, costed at the variant cost by default', async () => {
    const { apply, input, run } = setup();
    const results = await run(input([{ variantId: 'a', qty: 5 }, { variantId: 'b', qty: 2, unitCost: 30 }], [variant('a'), variant('b')]));

    expect(apply).toHaveBeenCalledTimes(1);
    const command = apply.mock.calls[0][1];
    expect(command).toMatchObject({ type: 'opening_balance', costType: 'opening_balance', idempotencyKey: 'opening:key-1', allowNegative: false });
    expect(command.lines.map((line: any) => [line.variantId, Number(line.unitCost)])).toEqual([['a', 12], ['b', 30]]);
    expect(results.map((result) => result.status)).toEqual(['posted', 'posted']);
  });

  it('refuses a variant that already has a movement and still posts the others', async () => {
    const { apply, input, run } = setup([['a'], []]);
    const results = await run(input([{ variantId: 'a', qty: 5 }, { variantId: 'b', qty: 2 }], [variant('a'), variant('b')]));

    expect(results[0]).toMatchObject({ status: 'rejected', code: 'OPENING_BALANCE_NOT_ALLOWED', variant_id: 'a' });
    expect(results[1]).toMatchObject({ status: 'posted', variant_id: 'b' });
    expect(apply.mock.calls[0][1].lines.map((line: any) => line.variantId)).toEqual(['b']);
  });

  it('does not call the engine when every line is refused', async () => {
    const { apply, input, run } = setup([['a']]);
    const results = await run(input([{ variantId: 'a', qty: 5 }], [variant('a')]));

    expect(results[0]).toMatchObject({ status: 'rejected', code: 'OPENING_BALANCE_NOT_ALLOWED' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('refuses tracked, non-stocked, unknown, duplicate, zero and over-precise lines with their own codes', async () => {
    const { input, run } = setup([[], []]);
    const results = await run(
      input(
        [
          { variantId: 'serial', qty: 1 },
          { variantId: 'service', qty: 1 },
          { variantId: 'missing', qty: 1 },
          { variantId: 'ok', qty: 1 },
          { variantId: 'ok', qty: 1 },
          { variantId: 'zero', qty: 0 },
          { variantId: 'piece', qty: 1.5 },
        ],
        [
          variant('serial', { tracking: 'serial' }),
          variant('service', { item_type: 'service' }),
          variant('ok'),
          variant('zero'),
          variant('piece'),
        ],
      ),
    );
    expect(results.map((result) => (result.status === 'posted' ? 'posted' : result.code))).toEqual([
      'TRACKED_VARIANT_NOT_SUPPORTED',
      'ITEM_NOT_STOCKED',
      'VARIANT_NOT_FOUND',
      'posted',
      'DUPLICATE_LINE',
      'QUANTITY_INVALID',
      'QUANTITY_PRECISION_EXCEEDED',
    ]);
  });

  it('turns a late movement (a concurrent request) into a retryable conflict and never reports success', async () => {
    const { input, run } = setup([[], ['a']]);
    await expect(run(input([{ variantId: 'a', qty: 5 }], [variant('a')]))).rejects.toMatchObject({
      response: { code: 'OPENING_BALANCE_CONFLICT' },
    });
  });

  it('skips the movement checks for variants the caller just created', async () => {
    const { tx, input, run } = setup();
    await run(input([{ variantId: 'a', qty: 5 }], [variant('a')], { variantsAreNew: true }));
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('names a reused idempotency key instead of leaking the engine message', async () => {
    const { apply, input, run } = setup();
    apply.mockRejectedValueOnce(new ConflictException('Inventory idempotency key belongs to a different command: x'));
    await expect(run(input([{ variantId: 'a', qty: 5 }], [variant('a')]))).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });
});
