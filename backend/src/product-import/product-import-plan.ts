import { nameKey, type ParsedRow, type RowIssue } from './product-import-row';

/**
 * The single planner behind both the dry run and the real run: given rows that
 * passed their own validation and what the database already holds, it decides
 * per row whether it is `ready` (will be created), `skipped` (its SKU exists)
 * or `failed`. Pure, so the two modes cannot disagree.
 */

export type Lookups = {
  /** Existing SKU -> variant id. */
  skuOwners: Map<string, string>;
  /** Existing barcode -> the variant that owns it. */
  barcodeOwners: Map<string, { variantId: string; sku: string }>;
  /** Units by normalised code / name. */
  units: Map<string, { id: string; precision: number; name: string }>;
  /** Product types by normalised name. */
  productTypes: Map<string, { id: string; needsAttributes: boolean }>;
  /** Product slots the plan still allows; null = unlimited. */
  remaining: number | null;
};

export type Verdict = {
  index: number;
  rowRef: string | number | null;
  sku: string;
  status: 'ready' | 'skipped' | 'failed';
  variantId?: string;
  errors: RowIssue[];
  warnings: RowIssue[];
  row: ParsedRow;
  unitId: string | null;
  unitPrecision: number;
  productTypeId: string | null;
};

const at = (row: { index: number; rowRef: string | number | null }) => row.rowRef ?? row.index + 1;

const issue = (code: string, field: string, message: string, message_ar: string, data?: Record<string, unknown>): RowIssue => ({
  code,
  field,
  message,
  message_ar,
  ...(data ? { data } : {}),
});

/** Rows that repeat a SKU or barcode of an earlier valid row of the same file (the first one wins). */
export function findFileDuplicates(rows: ParsedRow[]): Map<number, RowIssue> {
  const skus = new Map<string, ParsedRow>();
  const barcodes = new Map<string, ParsedRow>();
  const duplicates = new Map<number, RowIssue>();
  for (const row of rows) {
    const sameSku = skus.get(row.sku);
    if (sameSku) {
      duplicates.set(row.index, issue('IMPORT_DUPLICATE_SKU_IN_FILE', 'sku', `SKU ${row.sku} repeats row ${at(sameSku)}`, `SKU ${row.sku} مكرر في الملف (الصف ${at(sameSku)}).`, { sku: row.sku, first_row: at(sameSku) }));
      continue;
    }
    const clash = row.barcodes.find((code) => barcodes.has(code));
    if (clash) {
      const first = barcodes.get(clash)!;
      duplicates.set(row.index, issue('IMPORT_DUPLICATE_BARCODE_IN_FILE', 'barcode', `Barcode ${clash} repeats row ${at(first)}`, `الباركود ${clash} مكرر في الملف (الصف ${at(first)}).`, { barcode: clash, first_row: at(first) }));
      continue;
    }
    skus.set(row.sku, row);
    for (const code of row.barcodes) barcodes.set(code, row);
  }
  return duplicates;
}

/** Decides every row in order; `ready` rows consume the plan's product slots in that order. */
export function planRows(rows: ParsedRow[], lookups: Lookups, fileDuplicates: Map<number, RowIssue>): Verdict[] {
  let slots = lookups.remaining;
  return rows.map((row): Verdict => {
    const verdict: Verdict = {
      index: row.index,
      rowRef: row.rowRef,
      sku: row.sku,
      status: 'failed',
      errors: [],
      warnings: [...row.warnings],
      row,
      unitId: null,
      unitPrecision: 0,
      productTypeId: null,
    };
    const fail = (error: RowIssue): Verdict => ({ ...verdict, errors: [error] });

    const duplicate = fileDuplicates.get(row.index);
    if (duplicate) return fail(duplicate);

    const existing = lookups.skuOwners.get(row.sku);
    if (existing) {
      return { ...verdict, status: 'skipped', variantId: existing, errors: [issue('SKU_EXISTS', 'sku', 'The SKU already exists; it is left unchanged', 'SKU موجود بالفعل — لن يتغير.', { sku: row.sku })] };
    }

    const unit = row.unit ? lookups.units.get(nameKey(row.unit)) : undefined;
    if (row.unit && !unit) {
      return fail(issue('IMPORT_UNIT_UNKNOWN', 'unit', `Unit ${row.unit} is unknown`, `الوحدة ${row.unit} غير معروفة.`, { unit: row.unit }));
    }
    const precision = unit?.precision ?? 0;
    if (row.openingQty && (row.openingQty.split('.')[1] ?? '').replace(/0+$/, '').length > precision) {
      const label = unit?.name ?? 'قطعة';
      return fail(issue('IMPORT_QTY_PRECISION', 'opening_qty', `The unit allows at most ${precision} decimal place(s)`, `الكمية لا تقبل كسورًا لأن الوحدة ${label}.`, { precision }));
    }

    const type = row.productType ? lookups.productTypes.get(nameKey(row.productType)) : undefined;
    if (row.productType && !type) {
      return fail(issue('IMPORT_PRODUCT_TYPE_UNKNOWN', 'product_type', `Product type ${row.productType} does not exist`, `نوع المنتج ${row.productType} غير موجود.`, { product_type: row.productType }));
    }
    if (type?.needsAttributes) {
      return fail(issue('IMPORT_PRODUCT_TYPE_NEEDS_ATTRIBUTES', 'product_type', 'This product type needs attributes (size, colour...) that an import row cannot carry; add the item from the product screen', 'نوع المنتج هذا يحتاج خصائص (مثل المقاس واللون) لا يدعمها الاستيراد. أضف الصنف من شاشة المنتجات.', { product_type: row.productType }));
    }

    const taken = row.barcodes.map((code) => ({ code, owner: lookups.barcodeOwners.get(code) })).find((entry) => entry.owner);
    if (taken?.owner) {
      return fail(issue('CATALOG_BARCODE_CONFLICT', 'barcode', `Barcode ${taken.code} already belongs to ${taken.owner.sku}`, `الباركود ${taken.code} مستخدم بالفعل للصنف ${taken.owner.sku}.`, { barcode: taken.code, sku: taken.owner.sku }));
    }

    if (slots !== null) {
      if (slots <= 0) {
        return fail(issue('ENTITLEMENT_LIMIT_REACHED', 'plan', 'The plan limit on products is reached; this row is not imported', 'تجاوز حد الباقة.'));
      }
      slots -= 1;
    }
    return { ...verdict, status: 'ready', unitId: unit?.id ?? null, unitPrecision: precision, productTypeId: type?.id ?? null };
  });
}
