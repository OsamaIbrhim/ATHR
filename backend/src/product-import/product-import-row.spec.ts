import { parseImportRow, nameKey, type ParsedRow } from './product-import-row';

const parse = (raw: Record<string, unknown>, index = 0) => parseImportRow({ name: 'Milk 1L', price: 10, ...raw }, index);
const ok = (raw: Record<string, unknown>): ParsedRow => {
  const result = parse(raw);
  if (result.kind === 'invalid') throw new Error(`expected a valid row: ${JSON.stringify(result.errors)}`);
  return result.row;
};
const codes = (raw: Record<string, unknown>) => {
  const result = parse(raw);
  return result.kind === 'row' ? [] : result.errors.map((error) => error.code);
};

describe('parseImportRow', () => {
  it('reads a complete row, with text or number cells and Arabic digits', () => {
    const row = ok({ row_ref: 7, sku: 'MLK-1', barcode: '6221000111222; 6221000111333', price: '1,250.50', cost: '٩٩٫٥', opening_qty: '٢٤', unit: 'قطعة', category: 'ألبان' });
    expect(row).toMatchObject({ rowRef: 7, sku: 'MLK-1', barcodes: ['6221000111222', '6221000111333'], price: '1250.50', cost: '99.5', openingQty: '24', unit: 'قطعة', category: 'ألبان', index: 0 });
  });

  it('uses the first barcode as the SKU when there is no SKU', () => {
    expect(ok({ barcode: '6221000111222' }).sku).toBe('6221000111222');
  });

  it('needs a SKU or a barcode, a name and a price', () => {
    expect(codes({})).toEqual(['IMPORT_NO_IDENTITY']);
    expect(codes({ sku: 'A1', name: '' })).toEqual(['IMPORT_NAME_REQUIRED']);
    expect(codes({ sku: 'A1', price: undefined })).toEqual(['IMPORT_PRICE_INVALID']);
    expect(codes({ sku: 'A1', price: '' })).toEqual(['IMPORT_PRICE_INVALID']);
  });

  it.each([
    ['price', -1, 'IMPORT_PRICE_INVALID'],
    ['price', 'abc', 'IMPORT_PRICE_INVALID'],
    ['price', 1.234, 'IMPORT_PRICE_INVALID'],
    ['cost', -5, 'IMPORT_COST_INVALID'],
    ['cost', '12,5', 'IMPORT_COST_INVALID'],
    ['opening_qty', 'x', 'IMPORT_QTY_INVALID'],
    ['opening_qty', 1.2345, 'IMPORT_QTY_INVALID'],
    ['sku', 'x', 'IMPORT_SKU_INVALID'],
    ['barcode', 'bad code!', 'IMPORT_BARCODE_INVALID'],
  ])('reports %s = %p as %s', (field, value, code) => {
    expect(codes({ sku: 'A1', [field]: value })).toContain(code);
  });

  it('allows a zero price, treats a zero quantity as none, and keeps every problem of a row', () => {
    expect(ok({ sku: 'A1', price: 0 }).price).toBe('0');
    expect(ok({ sku: 'A1', opening_qty: 0 }).openingQty).toBeNull();
    expect(codes({ sku: 'A1', price: -1, cost: 'x', opening_qty: 'y' })).toEqual(['IMPORT_PRICE_INVALID', 'IMPORT_COST_INVALID', 'IMPORT_QTY_INVALID']);
  });

  it('warns, without failing, about a price under the cost and a quantity without a cost', () => {
    expect(ok({ sku: 'A1', price: 5, cost: 8 }).warnings.map((w) => w.code)).toEqual(['IMPORT_PRICE_BELOW_COST']);
    expect(ok({ sku: 'A1', opening_qty: 4 }).warnings.map((w) => w.code)).toEqual(['IMPORT_QTY_WITHOUT_COST']);
  });

  it('names the product in Arabic when it is written in Arabic', () => {
    expect(ok({ sku: 'A1', name: 'حليب كامل الدسم' }).nameAr).toBe('حليب كامل الدسم');
    expect(ok({ sku: 'A1', name: 'Milk' }).nameAr).toBeNull();
    expect(ok({ sku: 'A1', name: 'Milk', name_ar: 'لبن' }).nameAr).toBe('لبن');
  });

  it('never throws on a row that is not an object, and echoes the row reference', () => {
    expect(parseImportRow(null, 3)).toMatchObject({ kind: 'invalid', index: 3 });
    expect(parseImportRow('x', 4)).toMatchObject({ kind: 'invalid', index: 4 });
    expect(parseImportRow({ row_ref: 'r9' }, 5)).toMatchObject({ kind: 'invalid', rowRef: 'r9' });
  });

  it('matches names without regard to case, spaces or Arabic digits', () => {
    expect(nameKey('  Kilo   Gram ')).toBe('kilo gram');
    expect(nameKey('٣ قطع')).toBe('3 قطع');
  });
});
