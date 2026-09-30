import { findFileDuplicates, planRows, type Lookups } from './product-import-plan';
import { parseImportRow, type ParsedRow } from './product-import-row';

const row = (extra: Record<string, unknown>, index: number): ParsedRow => {
  const result = parseImportRow({ name: 'Item', price: 5, ...extra }, index);
  if (result.kind === 'invalid') throw new Error(JSON.stringify(result.errors));
  return result.row;
};
const lookups = (extra: Partial<Lookups> = {}): Lookups => ({
  skuOwners: new Map(),
  barcodeOwners: new Map(),
  units: new Map([['كجم', { id: 'u-kg', precision: 3, name: 'كجم' }], ['قطعة', { id: 'u-pc', precision: 0, name: 'قطعة' }]]),
  productTypes: new Map([['ملابس', { id: 't-clothes', needsAttributes: true }], ['عام', { id: 't-general', needsAttributes: false }]]),
  remaining: null,
  ...extra,
});
const plan = (rows: ParsedRow[], extra: Partial<Lookups> = {}) => planRows(rows, lookups(extra), findFileDuplicates(rows));
const summary = (verdicts: ReturnType<typeof plan>) => verdicts.map((v) => `${v.status}${v.errors[0] ? `:${v.errors[0].code}` : ''}`);

describe('findFileDuplicates', () => {
  it('the first valid row keeps a SKU or barcode, later ones repeat it', () => {
    const rows = [row({ sku: 'A1', barcode: '111' }, 0), row({ sku: 'A1' }, 1), row({ sku: 'B2', barcode: '111' }, 2), row({ sku: 'C3' }, 3)];
    const duplicates = findFileDuplicates(rows);
    expect([...duplicates.keys()]).toEqual([1, 2]);
    expect(duplicates.get(1)).toMatchObject({ code: 'IMPORT_DUPLICATE_SKU_IN_FILE', data: { first_row: 1 } });
    expect(duplicates.get(2)).toMatchObject({ code: 'IMPORT_DUPLICATE_BARCODE_IN_FILE', data: { barcode: '111', first_row: 1 } });
  });

  it('names the earlier row by its own row reference when it has one', () => {
    const duplicates = findFileDuplicates([row({ sku: 'A1', row_ref: 12 }, 0), row({ sku: 'A1', row_ref: 13 }, 1)]);
    expect(duplicates.get(1)?.data).toMatchObject({ first_row: 12 });
  });
});

describe('planRows', () => {
  it('skips an existing SKU and reports the variant that holds it', () => {
    const [verdict] = plan([row({ sku: 'A1' }, 0)], { skuOwners: new Map([['A1', 'variant-1']]) });
    expect(verdict).toMatchObject({ status: 'skipped', variantId: 'variant-1' });
    expect(verdict.errors[0].code).toBe('SKU_EXISTS');
  });

  it('fails a new SKU whose barcode belongs to another item', () => {
    const [verdict] = plan([row({ sku: 'A1', barcode: '111' }, 0)], { barcodeOwners: new Map([['111', { variantId: 'v9', sku: 'OLD-9' }]]) });
    expect(verdict.status).toBe('failed');
    expect(verdict.errors[0]).toMatchObject({ code: 'CATALOG_BARCODE_CONFLICT', data: { sku: 'OLD-9' } });
  });

  it('resolves units and refuses unknown ones and fractions a unit does not allow', () => {
    expect(summary(plan([row({ sku: 'A1', unit: 'كجم', opening_qty: 1.5 }, 0), row({ sku: 'A2', unit: 'لتر' }, 1), row({ sku: 'A3', unit: 'قطعة', opening_qty: 1.5 }, 2), row({ sku: 'A4', opening_qty: 2.5 }, 3)])))
      .toEqual(['ready', 'failed:IMPORT_UNIT_UNKNOWN', 'failed:IMPORT_QTY_PRECISION', 'failed:IMPORT_QTY_PRECISION']);
  });

  it('rejects an unknown product type and one that needs attributes', () => {
    expect(summary(plan([row({ sku: 'A1', product_type: 'سيارات' }, 0), row({ sku: 'A2', product_type: 'ملابس' }, 1), row({ sku: 'A3', product_type: 'عام' }, 2)])))
      .toEqual(['failed:IMPORT_PRODUCT_TYPE_UNKNOWN', 'failed:IMPORT_PRODUCT_TYPE_NEEDS_ATTRIBUTES', 'ready']);
  });

  it('gives only the plan\'s remaining product slots to ready rows, in file order, and never counts skipped rows', () => {
    const rows = [row({ sku: 'A1' }, 0), row({ sku: 'A2' }, 1), row({ sku: 'A3' }, 2), row({ sku: 'A4' }, 3)];
    expect(summary(plan(rows, { remaining: 2, skuOwners: new Map([['A1', 'v1']]) }))).toEqual(['skipped:SKU_EXISTS', 'ready', 'ready', 'failed:ENTITLEMENT_LIMIT_REACHED']);
    expect(summary(plan(rows, { remaining: 0 }))).toEqual(Array(4).fill('failed:ENTITLEMENT_LIMIT_REACHED'));
    expect(summary(plan(rows, { remaining: null }))).toEqual(Array(4).fill('ready'));
  });

  it('keeps the warnings of a ready row', () => {
    const [verdict] = plan([row({ sku: 'A1', price: 5, cost: 9 }, 0)]);
    expect(verdict.status).toBe('ready');
    expect(verdict.warnings.map((w) => w.code)).toEqual(['IMPORT_PRICE_BELOW_COST']);
  });

  it('is deterministic: the same rows and lookups always give the same verdicts (dry run == real run)', () => {
    const rows = [row({ sku: 'A1', barcode: '111' }, 0), row({ sku: 'A1' }, 1), row({ sku: 'A3', unit: 'x' }, 2), row({ sku: 'A4' }, 3)];
    expect(summary(plan(rows, { remaining: 1 }))).toEqual(summary(plan(rows, { remaining: 1 })));
  });
});
