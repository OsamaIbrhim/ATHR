import type { Prisma } from '@prisma/client';
import { nameKey, type ParsedRow } from './product-import-row';
import type { Lookups } from './product-import-plan';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | 'unitOfMeasure' | 'productType'>;

/** The SKUs and barcodes of these rows that already exist in the tenant: two statements however many rows. */
export async function loadExisting(db: Pick<Db, '$queryRaw'>, tenantId: string, rows: ParsedRow[]) {
  const skus = [...new Set(rows.map((row) => row.sku))];
  const codes = [...new Set(rows.flatMap((row) => row.barcodes))];
  const [skuRows, barcodeRows] = await Promise.all([
    skus.length
      ? db.$queryRaw<Array<{ id: string; sku: string }>>`
          SELECT "id", "sku" FROM "ProductVariant"
          WHERE "tenant_id" = ${tenantId}::uuid AND "sku" = ANY(${skus}::text[])
        `
      : Promise.resolve([] as Array<{ id: string; sku: string }>),
    codes.length
      ? db.$queryRaw<Array<{ code: string; variant_id: string; sku: string }>>`
          SELECT b."code", b."variant_id", v."sku"
          FROM "ProductBarcode" b
          JOIN "ProductVariant" v ON v."tenant_id" = b."tenant_id" AND v."id" = b."variant_id"
          WHERE b."tenant_id" = ${tenantId}::uuid AND b."code" = ANY(${codes}::text[])
        `
      : Promise.resolve([] as Array<{ code: string; variant_id: string; sku: string }>),
  ]);
  return {
    skuOwners: new Map(skuRows.map((row) => [row.sku, row.id])),
    barcodeOwners: new Map(barcodeRows.map((row) => [row.code, { variantId: row.variant_id, sku: row.sku }])),
  };
}

/** Active units of the tenant, reachable by code, English or Arabic name. */
export async function loadUnits(db: Pick<Db, 'unitOfMeasure'>, tenantId: string): Promise<Lookups['units']> {
  const units = await db.unitOfMeasure.findMany({
    where: { tenant_id: tenantId, is_active: true },
    select: { id: true, code: true, name_en: true, name_ar: true, precision: true },
  });
  const map: Lookups['units'] = new Map();
  for (const unit of units) {
    const entry = { id: unit.id, precision: unit.precision, name: unit.name_ar ?? unit.name_en };
    for (const label of [unit.code, unit.name_en, unit.name_ar]) if (label) map.set(nameKey(label), entry);
  }
  return map;
}

/** Active product types by name; a type with an axis attribute cannot be filled from an import row. */
export async function loadProductTypes(db: Pick<Db, 'productType'>, tenantId: string): Promise<Lookups['productTypes']> {
  const types = await db.productType.findMany({
    where: { tenant_id: tenantId, is_active: true },
    select: { id: true, name_ar: true, name_en: true, attributes: true },
  });
  const map: Lookups['productTypes'] = new Map();
  for (const type of types) {
    const attributes = Array.isArray(type.attributes) ? (type.attributes as Array<{ axis?: boolean }>) : [];
    const entry = { id: type.id, needsAttributes: attributes.some((attribute) => attribute?.axis === true) };
    for (const label of [type.name_ar, type.name_en]) if (label) map.set(nameKey(label), entry);
  }
  return map;
}
