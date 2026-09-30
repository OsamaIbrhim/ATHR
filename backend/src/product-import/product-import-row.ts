/**
 * One row of a product import file, validated on its own (no database). The
 * admin parses the Excel / CSV file and sends rows as JSON; every cell may
 * arrive as a number or as text, so this is the one place that reads cells.
 * The limits repeat the create-product DTO (SKU 2-100, barcode pattern, name
 * 2-200, at most 20 barcodes, price <= 9,999,999,999.99).
 */

export type RowIssue = {
  code: string;
  field?: string;
  message: string;
  message_ar: string;
  data?: Record<string, unknown>;
};

export type ParsedRow = {
  index: number;
  rowRef: string | number | null;
  sku: string;
  name: string;
  nameAr: string | null;
  barcodes: string[];
  price: string;
  cost: string | null;
  openingQty: string | null;
  unit: string | null;
  category: string | null;
  productType: string | null;
  warnings: RowIssue[];
};

export type RowParse = { kind: 'row'; row: ParsedRow } | { kind: 'invalid'; index: number; rowRef: string | number | null; sku: string | null; errors: RowIssue[] };

export const MAX_IMPORT_ROWS = 2000;
export const MAX_BARCODES_PER_ROW = 20;
const BARCODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_PRICE = 9_999_999_999.99;
const MAX_COST = 9_999_999_999;
const MAX_QTY = 99_999_999.999;
const ARABIC_LETTERS = /[؀-ۿ]/;

const issue = (code: string, field: string, message: string, message_ar: string, data?: Record<string, unknown>): RowIssue => ({
  code,
  field,
  message,
  message_ar,
  ...(data ? { data } : {}),
});

const digits = (text: string) => text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** Text of a cell: trimmed, empty = absent. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result ? result : null;
}

type NumberCell = { kind: 'absent' } | { kind: 'invalid' } | { kind: 'ok'; value: number; text: string };

/** A numeric cell: a number, or text such as "1,250.50" or "٢٥". */
function numberCell(value: unknown): NumberCell {
  const raw = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : 'x') : text(value);
  if (raw === null) return { kind: 'absent' };
  const cleaned = digits(raw).replace(/٫/g, '.').replace(/\s/g, '');
  const normalised = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned) ? cleaned.replace(/,/g, '') : cleaned;
  if (!/^\d+(\.\d+)?$/.test(normalised)) return { kind: 'invalid' };
  return { kind: 'ok', value: Number(normalised), text: normalised };
}

const decimalPlaces = (numeric: string) => (numeric.split('.')[1] ?? '').replace(/0+$/, '').length;

/** Barcodes from a list or from text separated by ; , or line breaks. */
function barcodesOf(row: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const source of [row.barcodes, row.barcode]) {
    if (Array.isArray(source)) parts.push(...source.map((item) => String(item ?? '')));
    else if (source !== null && source !== undefined) parts.push(...String(source).split(/[;,\n؛،]/));
  }
  const cleaned = parts.map((part) => digits(part.trim())).filter(Boolean);
  return [...new Set(cleaned)];
}

/** Validates one raw row. Never throws: problems come back as issues. */
export function parseImportRow(raw: unknown, index: number): RowParse {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const refCell = source.row_ref;
  const rowRef = typeof refCell === 'number' || typeof refCell === 'string' ? refCell : null;
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  const name = text(source.name);
  if (!name) errors.push(issue('IMPORT_NAME_REQUIRED', 'name', 'The product name is empty', 'اسم المنتج فارغ.'));
  else if (name.length < 2 || name.length > 200) {
    errors.push(issue('IMPORT_NAME_INVALID', 'name', 'The product name must be 2-200 characters', 'اسم المنتج يجب أن يكون من حرفين إلى 200 حرف.'));
  }

  const barcodes = barcodesOf(source);
  if (barcodes.length > MAX_BARCODES_PER_ROW) {
    errors.push(issue('IMPORT_BARCODE_INVALID', 'barcode', `At most ${MAX_BARCODES_PER_ROW} barcodes per item`, 'عدد الباركودات أكبر من المسموح للصنف.'));
  }
  const badBarcode = barcodes.find((code) => !BARCODE_PATTERN.test(code));
  if (badBarcode) {
    errors.push(issue('IMPORT_BARCODE_INVALID', 'barcode', `Barcode ${badBarcode} must be 1-64 letters, digits, dot, dash or underscore`, `الباركود ${badBarcode} غير صالح: حروف وأرقام ونقطة وشرطة فقط.`, { barcode: badBarcode }));
  }

  // The SKU is the identity of the row; with no SKU the first barcode stands in for it.
  const explicitSku = text(source.sku);
  const sku = explicitSku ?? barcodes[0] ?? null;
  if (!sku) {
    errors.push(issue('IMPORT_NO_IDENTITY', 'sku', 'The row has neither a SKU nor a barcode', 'لا يوجد SKU ولا باركود — لا يمكن تمييز الصنف.'));
  } else if (sku.length < 2 || sku.length > 100) {
    errors.push(issue('IMPORT_SKU_INVALID', 'sku', 'The SKU must be 2-100 characters', 'الـSKU يجب أن يكون من حرفين إلى 100 حرف.'));
  }

  const price = numberCell(source.price);
  if (price.kind !== 'ok' || price.value > MAX_PRICE || decimalPlaces(price.text) > 2) {
    errors.push(issue('IMPORT_PRICE_INVALID', 'price', 'The price must be a number >= 0 with at most 2 decimals', 'السعر غير صالح — اكتب رقمًا أكبر من أو يساوي صفر.'));
  }
  const cost = numberCell(source.cost);
  if (cost.kind === 'invalid' || (cost.kind === 'ok' && (cost.value > MAX_COST || decimalPlaces(cost.text) > 4))) {
    errors.push(issue('IMPORT_COST_INVALID', 'cost', 'The cost must be a number >= 0 with at most 4 decimals', 'التكلفة غير صالحة — اكتب رقمًا أكبر من أو يساوي صفر.'));
  }
  const qty = numberCell(source.opening_qty);
  if (qty.kind === 'invalid' || (qty.kind === 'ok' && (qty.value > MAX_QTY || decimalPlaces(qty.text) > 3))) {
    errors.push(issue('IMPORT_QTY_INVALID', 'opening_qty', 'The quantity must be a number >= 0 with at most 3 decimals', 'الكمية غير صالحة.'));
  }

  if (errors.length || !sku || !name || price.kind !== 'ok') {
    return { kind: 'invalid', index, rowRef, sku, errors };
  }

  const openingQty = qty.kind === 'ok' && qty.value > 0 ? qty.text : null;
  if (price.kind === 'ok' && cost.kind === 'ok' && price.value < cost.value) {
    warnings.push(issue('IMPORT_PRICE_BELOW_COST', 'price', 'The selling price is below the cost', 'سعر البيع أقل من التكلفة.'));
  }
  if (openingQty && cost.kind === 'absent') {
    warnings.push(issue('IMPORT_QTY_WITHOUT_COST', 'cost', 'A quantity without a cost is recorded at cost zero', 'الكمية بدون تكلفة.'));
  }
  const nameAr = text(source.name_ar) ?? (ARABIC_LETTERS.test(name) ? name : null);
  return {
    kind: 'row',
    row: {
      index,
      rowRef,
      sku,
      name,
      nameAr,
      barcodes,
      price: price.text,
      cost: cost.kind === 'ok' ? cost.text : null,
      openingQty,
      unit: text(source.unit),
      category: text(source.category),
      productType: text(source.product_type),
      warnings,
    },
  };
}

/** The normal form used to match unit, category and product type names. */
export const nameKey = (value: string) => digits(value).trim().replace(/\s+/g, ' ').toLowerCase();
