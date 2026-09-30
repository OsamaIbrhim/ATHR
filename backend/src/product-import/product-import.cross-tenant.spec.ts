import { randomUUID } from 'crypto';
import { ProductImportService } from './product-import.service';
import { loadExisting } from './product-import-lookups';
import { parseImportRow, type ParsedRow } from './product-import-row';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aBranch } from '../identity/testing/fixture-builders';

/** Cross-tenant isolation of the bulk import: every lookup and write is bound to the calling tenant. */

const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    branch: [aBranch({ id: BRANCH_A, tenant_id: TENANT_A }), aBranch({ id: BRANCH_B, tenant_id: TENANT_B })],
    unitOfMeasure: [{ id: 'unit-b', tenant_id: TENANT_B, code: 'KG', name_en: 'Kilo', name_ar: 'كجم', precision: 3, is_active: true }],
    productType: [{ id: 'type-b', tenant_id: TENANT_B, name_ar: 'خاص', name_en: 'Private', attributes: [], is_active: true }],
  });
  const captured: string[] = [];
  prisma.$queryRaw = async (strings: any) => {
    captured.push(Array.isArray(strings) ? strings.join('?') : String(strings?.strings?.join('?')));
    return [];
  };
  prisma.$executeRaw = async () => 0;
  prisma.$transaction = async (fn: any) => fn(prisma);
  prisma.priceBook = { findFirst: async () => ({ id: randomUUID() }) };
  prisma.tenant = { findUniqueOrThrow: async () => ({ default_currency: 'EGP' }) };
  const inventory: any = { defaultWarehouseId: async () => randomUUID(), apply: async () => [] };
  const limits: any = { headroom: async () => ({ limit: null, current: 0, remaining: null }) };
  const tax: any = { findDefaultCategory: async () => ({ id: randomUUID() }) };
  return { captured, service: new ProductImportService(prisma, inventory, limits, tax) };
}

const owner = () => actorFor('tenant_owner', { sub: randomUUID(), tenantWide: true });
const row = (extra: Record<string, unknown>): ParsedRow => {
  const parsed = parseImportRow({ sku: 'SKU-1', barcode: '111', name: 'Item', price: 5, ...extra }, 0);
  if (parsed.kind !== 'row') throw new Error('invalid fixture');
  return parsed.row;
};

describe('product import — cross-tenant isolation', () => {
  it('binds the tenant into both catalogue lookups (existing SKUs and barcodes)', async () => {
    const { captured } = setup();
    const db: any = { $queryRaw: async (strings: any) => { captured.push(strings.join('?')); return []; } };
    await loadExisting(db, TENANT_A, [row({})]);
    expect(captured).toHaveLength(2);
    for (const sql of captured) expect(sql).toMatch(/"tenant_id" = \?::uuid/);
  });

  it('does not find another tenant\'s branch for the opening quantities', async () => {
    const { service } = setup();
    const dto = { dry_run: true, price_tax_mode: 'inclusive', branch_id: BRANCH_B, rows: [{ sku: 'A1', name: 'Item', price: 5, opening_qty: 3 }] } as any;
    await expect(service.import(contextFor(TENANT_A), dto, owner())).rejects.toThrow('Branch not found');
    await expect(service.import(contextFor(TENANT_B), { ...dto, branch_id: BRANCH_A }, owner())).rejects.toThrow('Branch not found');
  });

  it('does not resolve another tenant\'s units or product types', async () => {
    const { service } = setup();
    const dto = {
      dry_run: true,
      price_tax_mode: 'inclusive',
      rows: [
        { sku: 'A1', name: 'Loose', price: 5, unit: 'كجم' },
        { sku: 'A2', name: 'Typed', price: 5, product_type: 'خاص' },
      ],
    } as any;
    const asA = await service.import(contextFor(TENANT_A), dto, owner());
    expect(asA.rows.map((r: any) => r.errors[0]?.code)).toEqual(['IMPORT_UNIT_UNKNOWN', 'IMPORT_PRODUCT_TYPE_UNKNOWN']);
    const asB = await service.import(contextFor(TENANT_B), dto, owner());
    expect(asB.rows.map((r: any) => r.status)).toEqual(['ready', 'ready']);
  });
});
