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

/**
 * A transaction whose reads are scripted: `own` are the movements this key already holds, `prior` the
 * variants with movements of other commands (first check, second check, ...).
 */
function setup(options: { own?: Array<{ variant_id: string; on_hand_delta: Prisma.Decimal; on_hand_after: Prisma.Decimal; cost_after: Prisma.Decimal | null }>; prior?: string[][] } = {}) {
  const prior = [...(options.prior ?? [[], []])];
  const tx: any = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
      strings.join('?').includes('<>') ? (prior.shift() ?? []).map((variant_id) => ({ variant_id })) : (options.own ?? []),
    ),
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
    const { apply, input, run } = setup({ prior: [['a'], []] });
    const results = await run(input([{ variantId: 'a', qty: 5 }, { variantId: 'b', qty: 2 }], [variant('a'), variant('b')]));

    expect(results[0]).toMatchObject({ status: 'rejected', code: 'OPENING_BALANCE_NOT_ALLOWED', variant_id: 'a' });
    expect(results[1]).toMatchObject({ status: 'posted', variant_id: 'b' });
    expect(apply.mock.calls[0][1].lines.map((line: any) => line.variantId)).toEqual(['b']);
  });

  it('does not call the engine when every line is refused', async () => {
    const { apply, input, run } = setup({ prior: [['a']] });
    const results = await run(input([{ variantId: 'a', qty: 5 }], [variant('a')]));

    expect(results[0]).toMatchObject({ status: 'rejected', code: 'OPENING_BALANCE_NOT_ALLOWED' });
    expect(apply).not.toHaveBeenCalled();
  });

  it('refuses tracked, non-stocked, unknown, duplicate, zero and over-precise lines with their own codes', async () => {
    const { input, run } = setup({ prior: [[], []] });
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
    const { input, run } = setup({ prior: [[], ['a']] });
    await expect(run(input([{ variantId: 'a', qty: 5 }], [variant('a')]))).rejects.toMatchObject({
      response: { code: 'OPENING_BALANCE_CONFLICT' },
    });
  });

  describe('a retried request (the key already holds movements)', () => {
    const ownRow = (variant_id: string, qty: number) => ({ variant_id, on_hand_delta: D(qty), on_hand_after: D(qty), cost_after: D(12) });

    it('is answered from what the key posted even though the items have sold since', async () => {
      // `a` and `b` sold after the first request: a movement of another command exists for both.
      const { apply, input, run } = setup({ own: [ownRow('a', 5), ownRow('b', 2)], prior: [['a', 'b']] });
      const results = await run(input([{ variantId: 'a', qty: 5 }, { variantId: 'b', qty: 2 }], [variant('a'), variant('b')]));

      expect(results.map((result) => result.status)).toEqual(['posted', 'posted']);
      expect(apply).not.toHaveBeenCalled();
    });

    it('a single-line retry after a sale is a replay, not a refusal', async () => {
      const { apply, input, run } = setup({ own: [ownRow('c', 4)], prior: [['c']] });
      const [result] = await run(input([{ variantId: 'c', qty: 4 }], [variant('c')]));
      expect(result).toMatchObject({ status: 'posted', variant_id: 'c' });
      expect(apply).not.toHaveBeenCalled();
    });

    it('keeps refusing the line the first request was refused for, and posts the rest', async () => {
      const { input, run } = setup({ own: [ownRow('b', 2)], prior: [['a']] });
      const results = await run(input([{ variantId: 'a', qty: 5 }, { variantId: 'b', qty: 2 }], [variant('a'), variant('b')]));
      expect(results.map((result) => (result.status === 'posted' ? 'posted' : result.code))).toEqual(['OPENING_BALANCE_NOT_ALLOWED', 'posted']);
    });

    it('refuses a payload that changed under the same key', async () => {
      const changedQty = setup({ own: [ownRow('a', 5)] });
      await expect(changedQty.run(changedQty.input([{ variantId: 'a', qty: 9 }], [variant('a')]))).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });

      const extraLine = setup({ own: [ownRow('a', 5)], prior: [[]] });
      await expect(extraLine.run(extraLine.input([{ variantId: 'a', qty: 5 }, { variantId: 'b', qty: 1 }], [variant('a'), variant('b')]))).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });

      const dropped = setup({ own: [ownRow('a', 5), ownRow('b', 2)] });
      await expect(dropped.run(dropped.input([{ variantId: 'a', qty: 5 }], [variant('a')]))).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
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
