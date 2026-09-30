import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { postOpeningBalance } from '../opening-balance/opening-balance';
import type { InventoryService } from '../inventory/inventory.service';
import type { StockVariant } from '../inventory/inventory-variants';
import { nameKey } from './product-import-row';
import type { Verdict } from './product-import-plan';

type Tx = Prisma.TransactionClient;

export type BatchContext = {
  tenantId: string;
  actorId: string;
  taxCategoryId: string;
  /** Null when no row carries a price to store. */
  priceBookId: string | null;
  priceTaxMode: 'inclusive' | 'exclusive';
  /** Warehouse that receives opening quantities; null when no row has one. */
  warehouseId: string | null;
};

export type BatchWritten = {
  /** Row index -> the created variant. */
  variantIds: Map<number, string>;
  categoriesCreated: number;
  openingPosted: number;
};

/**
 * Creates the `ready` rows of one batch in a fixed number of statements, however
 * many rows: categories (select + insert), products, variants, barcodes, price
 * entries, then the opening quantities through the opening-balance path.
 * Ids are generated here so children can name their parents without reading
 * anything back. Runs inside the caller's transaction; any error rolls the
 * whole batch back, so a batch is created completely or not at all.
 */
export async function writeBatch(
  inventory: Pick<InventoryService, 'apply'>,
  tx: Tx,
  ctx: BatchContext,
  ready: Verdict[],
): Promise<BatchWritten> {
  const { categoryIds, created: categoriesCreated } = await resolveCategories(tx, ctx.tenantId, ready);

  const made = ready.map((verdict) => ({ verdict, productId: randomUUID(), variantId: randomUUID() }));
  const tenantId = ctx.tenantId;

  await tx.$executeRaw`
    INSERT INTO "Product" ("id", "tenant_id", "name_en", "name_ar", "category_id", "product_type_id", "tax_category_id", "has_variants")
    SELECT u."id", ${tenantId}::uuid, u."name_en", NULLIF(u."name_ar", ''), NULLIF(u."category_id", '')::uuid,
           NULLIF(u."type_id", '')::uuid, ${ctx.taxCategoryId}::uuid, u."has_variants"
    FROM unnest(
      ${made.map((item) => item.productId)}::uuid[],
      ${made.map((item) => item.verdict.row.name)}::text[],
      ${made.map((item) => item.verdict.row.nameAr ?? '')}::text[],
      ${made.map((item) => (item.verdict.row.category ? (categoryIds.get(nameKey(item.verdict.row.category)) ?? '') : ''))}::text[],
      ${made.map((item) => item.verdict.productTypeId ?? '')}::text[],
      ${made.map((item) => item.verdict.productTypeId !== null)}::boolean[]
    ) AS u("id", "name_en", "name_ar", "category_id", "type_id", "has_variants")
  `;
  await tx.$executeRaw`
    INSERT INTO "ProductVariant" ("id", "tenant_id", "product_id", "sku", "cost_price", "base_uom_id")
    SELECT u."id", ${tenantId}::uuid, u."product_id", u."sku", u."cost"::numeric, NULLIF(u."uom", '')::uuid
    FROM unnest(
      ${made.map((item) => item.variantId)}::uuid[],
      ${made.map((item) => item.productId)}::uuid[],
      ${made.map((item) => item.verdict.row.sku)}::text[],
      ${made.map((item) => item.verdict.row.cost ?? '0')}::text[],
      ${made.map((item) => item.verdict.unitId ?? '')}::text[]
    ) AS u("id", "product_id", "sku", "cost", "uom")
  `;

  const codes = made.flatMap((item) => item.verdict.row.barcodes.map((code) => ({ code, variantId: item.variantId })));
  if (codes.length) {
    await tx.$executeRaw`
      INSERT INTO "ProductBarcode" ("id", "tenant_id", "code", "variant_id")
      SELECT gen_random_uuid(), ${tenantId}::uuid, u."code", u."variant_id"
      FROM unnest(${codes.map((entry) => entry.code)}::text[], ${codes.map((entry) => entry.variantId)}::uuid[]) AS u("code", "variant_id")
    `;
  }

  if (ctx.priceBookId) {
    await tx.$executeRaw`
      INSERT INTO "PriceBookEntry" (
        "id", "tenant_id", "price_book_id", "scope_type", "scope_id", "min_qty", "unit_price",
        "allow_zero_price", "tax_mode", "version", "status", "created_by"
      )
      SELECT gen_random_uuid(), ${tenantId}::uuid, ${ctx.priceBookId}::uuid, 'variant'::"PriceEntryScopeType", u."variant_id", 1, u."price"::numeric,
             u."price"::numeric = 0, ${ctx.priceTaxMode}::"TaxMode", 1, 'active'::"PriceEntryStatus", ${ctx.actorId}::uuid
      FROM unnest(${made.map((item) => item.variantId)}::uuid[], ${made.map((item) => item.verdict.row.price)}::text[]) AS u("variant_id", "price")
    `;
  }

  const opening = made.filter((item) => item.verdict.row.openingQty && ctx.warehouseId);
  let openingPosted = 0;
  if (opening.length && ctx.warehouseId) {
    const variants = new Map<string, StockVariant>(
      opening.map((item) => [
        item.variantId,
        {
          id: item.variantId,
          sku: item.verdict.row.sku,
          item_type: 'stocked',
          tracking: 'none',
          cost_price: new Prisma.Decimal(item.verdict.row.cost ?? '0'),
          precision: item.verdict.unitPrecision,
        },
      ]),
    );
    const results = await postOpeningBalance(inventory, tx, {
      tenantId,
      warehouseId: ctx.warehouseId,
      actorId: ctx.actorId,
      idempotencyKey: `import-opening:${randomUUID()}`,
      referenceId: randomUUID(),
      variantsAreNew: true,
      variants,
      lines: opening.map((item, index) => ({ index, variantId: item.variantId, qty: item.verdict.row.openingQty!, unitCost: item.verdict.row.cost ?? '0' })),
    });
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected) throw new Error(`Opening quantity was refused for a new item (${rejected.code})`);
    openingPosted = results.length;
  }

  await tx.auditLog.create({
    data: {
      tenant_id: tenantId,
      user_id: ctx.actorId,
      action: 'catalog.products_imported',
      entity: 'Product',
      meta: { products: made.length, opening_quantities: openingPosted, categories_created: categoriesCreated },
    },
  });
  return { variantIds: new Map(made.map((item) => [item.verdict.index, item.variantId])), categoriesCreated, openingPosted };
}

/**
 * Category ids for the names of these rows: finds existing ones (by Arabic or
 * English name, ignoring case) and creates the rest, all in at most two statements.
 */
async function resolveCategories(tx: Tx, tenantId: string, ready: Verdict[]) {
  const wanted = new Map<string, string>();
  for (const { row } of ready) if (row.category && !wanted.has(nameKey(row.category))) wanted.set(nameKey(row.category), row.category);
  const categoryIds = new Map<string, string>();
  if (!wanted.size) return { categoryIds, created: 0 };

  const keys = [...wanted.keys()];
  const found = await tx.$queryRaw<Array<{ id: string; name_ar: string; name_en: string | null }>>`
    SELECT "id", "name_ar", "name_en" FROM "Category"
    WHERE "tenant_id" = ${tenantId}::uuid
      AND (lower(btrim("name_ar")) = ANY(${keys}::text[]) OR lower(btrim(COALESCE("name_en", ''))) = ANY(${keys}::text[]))
  `;
  for (const category of found) {
    for (const label of [category.name_ar, category.name_en]) if (label && wanted.has(nameKey(label))) categoryIds.set(nameKey(label), category.id);
  }
  const missing = keys.filter((key) => !categoryIds.has(key));
  if (!missing.length) return { categoryIds, created: 0 };

  const created = await tx.$queryRaw<Array<{ id: string; name_ar: string }>>`
    INSERT INTO "Category" ("id", "tenant_id", "name_ar")
    SELECT gen_random_uuid(), ${tenantId}::uuid, u."name"
    FROM unnest(${missing.map((key) => wanted.get(key)!)}::text[]) AS u("name")
    RETURNING "id", "name_ar"
  `;
  for (const category of created) categoryIds.set(nameKey(category.name_ar), category.id);
  return { categoryIds, created: created.length };
}
