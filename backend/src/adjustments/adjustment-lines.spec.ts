import { Prisma } from '@prisma/client';
import { validateAdjustmentLines } from './adjustment-lines';
import type { StockVariant } from '../inventory/inventory-variants';

const variant = (id: string, extra: Partial<StockVariant> = {}): StockVariant => ({
  id,
  sku: `SKU-${id}`,
  item_type: 'stocked',
  tracking: 'none',
  cost_price: new Prisma.Decimal(10),
  precision: 0,
  ...extra,
});
const variants = (...list: StockVariant[]) => new Map(list.map((v) => [v.id, v]));
const line = (extra: Record<string, unknown>) => ({ variant_id: 'a', qty_delta: -2, reason_code: 'damaged', ...extra }) as any;
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error: any) {
    return { code: error.response?.code, data: error.response?.data };
  }
};

describe('validateAdjustmentLines', () => {
  it('normalises signed lines and trims notes', () => {
    const lines = validateAdjustmentLines([line({ note: '  cracked  ' }), line({ variant_id: 'b', qty_delta: 4, reason_code: 'correction' })], variants(variant('a'), variant('b')));
    expect(lines.map((l) => [l.variant_id, l.qty_delta.toString(), l.reason_code, l.note])).toEqual([
      ['a', '-2', 'damaged', 'cracked'],
      ['b', '4', 'correction', null],
    ]);
  });

  it('refuses the same item twice and says which line', () => {
    expect(codeOf(() => validateAdjustmentLines([line({}), line({})], variants(variant('a'))))).toEqual({
      code: 'DUPLICATE_LINE',
      data: { line_index: 1, variant_id: 'a' },
    });
  });

  it('needs a note for the reason "other"', () => {
    expect(codeOf(() => validateAdjustmentLines([line({ reason_code: 'other' })], variants(variant('a'))))?.code).toBe('ADJUSTMENT_NOTE_REQUIRED');
    expect(codeOf(() => validateAdjustmentLines([line({ reason_code: 'other', note: '   ' })], variants(variant('a'))))?.code).toBe('ADJUSTMENT_NOTE_REQUIRED');
    expect(codeOf(() => validateAdjustmentLines([line({ reason_code: 'other', note: 'sample' })], variants(variant('a'))))).toBeNull();
  });

  it('refuses tracked, non-stocked, unknown and over-precise items', () => {
    expect(codeOf(() => validateAdjustmentLines([line({})], variants(variant('a', { tracking: 'batch' }))))?.code).toBe('TRACKED_VARIANT_NOT_SUPPORTED');
    expect(codeOf(() => validateAdjustmentLines([line({})], variants(variant('a', { item_type: 'service' }))))?.code).toBe('ITEM_NOT_STOCKED');
    expect(codeOf(() => validateAdjustmentLines([line({})], variants()))?.code).toBe('VARIANT_NOT_FOUND');
    expect(codeOf(() => validateAdjustmentLines([line({ qty_delta: 1.5 })], variants(variant('a'))))?.code).toBe('QUANTITY_PRECISION_EXCEEDED');
    expect(codeOf(() => validateAdjustmentLines([line({ qty_delta: 1.5 })], variants(variant('a', { precision: 3 }))))).toBeNull();
  });
});
