import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { SyncService } from './sync.service';
import { PricingService } from '../pricing/pricing.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aProduct, aProductVariant, aTaxCategory, aTaxCode, anInventoryStock } from '../identity/testing/fixture-builders';
import { TaxResolutionService } from '../tax/tax-resolution.service';

/**
 * WP-007 Phase A §A.3.6 — cross-tenant isolation for the `sync` module.
 *
 * Multi-tenancy Blueprint §123: "Resync cannot return another Tenant data".
 * This is the feed that populates every POS device's local database, so a
 * missing predicate here does not just leak a query result — it writes
 * another tenant's catalogue and prices onto a physical till.
 */

const PRODUCT_A = randomUUID();
const PRODUCT_B = randomUUID();
const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const WAREHOUSE_A = randomUUID();
const WAREHOUSE_B = randomUUID();
const PRICE_BOOK_A = randomUUID();
const PRICE_BOOK_B = randomUUID();

function setup() {
  const productA = aProduct({ id: PRODUCT_A, tenant_id: TENANT_A, name_en: 'A widget' });
  const productB = aProduct({ id: PRODUCT_B, tenant_id: TENANT_B, name_en: 'B widget' });
  const prisma = fakePrisma({
    taxCategory: [
      aTaxCategory({ tenant_id: TENANT_A }),
      aTaxCategory({ tenant_id: TENANT_B }),
    ],
    taxCode: [
      aTaxCode({ tenant_id: TENANT_A }),
      aTaxCode({ tenant_id: TENANT_B }),
    ],
    tenant: [
      { id: TENANT_A, settings: {}, sync_floor: '0:0' },
      { id: TENANT_B, settings: {}, sync_floor: '0:0' },
    ],
    productBarcode: [
      { id: randomUUID(), tenant_id: TENANT_A, code: 'A-CODE', variant_id: VARIANT_A, pack_qty: 1, kind: 'standard', created_at: new Date() },
      { id: randomUUID(), tenant_id: TENANT_B, code: 'B-CODE', variant_id: VARIANT_B, pack_qty: 1, kind: 'standard', created_at: new Date() },
    ],
    unitOfMeasure: [],
    product: [productA, productB],
    productVariant: [
      aProductVariant({
        id: VARIANT_A,
        tenant_id: TENANT_A,
        product_id: PRODUCT_A,
        sku: 'A-1',
        cost_price: new Prisma.Decimal(10),
        // Pre-hydrated relation: the snapshot projects the parent product.
        product: { ...productA },
      }),
      aProductVariant({
        id: VARIANT_B,
        tenant_id: TENANT_B,
        product_id: PRODUCT_B,
        sku: 'B-1',
        cost_price: new Prisma.Decimal(10),
        product: { ...productB },
      }),
    ],
    inventoryStock: [
      anInventoryStock({ tenant_id: TENANT_A, warehouse_id: WAREHOUSE_A, variant_id: VARIANT_A, qty_on_hand: 3 }),
      anInventoryStock({ tenant_id: TENANT_B, warehouse_id: WAREHOUSE_B, variant_id: VARIANT_B, qty_on_hand: 7 }),
    ],
    priceBook: [
      { id: PRICE_BOOK_A, tenant_id: TENANT_A, status: 'active', is_default: true },
      { id: PRICE_BOOK_B, tenant_id: TENANT_B, status: 'active', is_default: true },
    ],
    priceBookEntry: [
      {
        id: randomUUID(), tenant_id: TENANT_A, price_book_id: PRICE_BOOK_A,
        scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 20,
        allow_zero_price: false, tax_percent: 14, floor_price: null,
        effective_from: new Date(0), effective_to: null, status: 'active',
      },
      {
        id: randomUUID(), tenant_id: TENANT_B, price_book_id: PRICE_BOOK_B,
        scope_type: 'global', scope_id: null, min_qty: 1, unit_price: 30,
        allow_zero_price: false, tax_percent: 14, floor_price: null,
        effective_from: new Date(0), effective_to: null, status: 'active',
      },
    ],
    pricingRule: [],
    membership: [],
  }, {
    productVariant: { product: { table: 'product', localKey: 'product_id' } },
    priceBookEntry: { price_book: { table: 'priceBook', localKey: 'price_book_id' } },
  });
  // Raw change-stream reads: record what each statement is bound to.
  const rawCalls: Array<{ sql: string; values: unknown[] }> = [];
  prisma.$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    rawCalls.push({ sql: strings.join('?'), values });
    return [];
  };
  // The default warehouse of a branch (the stock a POS syncs).
  const inventory = {
    defaultWarehouseId: async (_db: unknown, _tenantId: string, branchId: string) =>
      branchId === BRANCH_A ? WAREHOUSE_A : WAREHOUSE_B,
  } as any;
  return { prisma, rawCalls, service: new SyncService(prisma, new PricingService(prisma, new TaxResolutionService(prisma)), new TaxResolutionService(prisma), inventory) };
}

describe('sync — cross-tenant isolation (Blueprint §123)', () => {
  it('snapshots only the calling tenant\'s catalogue onto a device', async () => {
    const { service } = setup();
    const forA: any = await service.pull(contextFor(TENANT_A), BRANCH_A);

    expect(forA.mode).toBe('snapshot');
    expect(forA.products.map((p: any) => p.sku)).toEqual(['A-1']);
    expect(forA.stock.map((s: any) => s.variant_id)).toEqual([VARIANT_A]);
  });

  it('gives a second tenant an entirely disjoint snapshot', async () => {
    const { service } = setup();
    const forB: any = await service.pull(contextFor(TENANT_B), BRANCH_B);

    expect(forB.products.map((p: any) => p.sku)).toEqual(['B-1']);
    expect(forB.products.map((p: any) => p.id)).not.toContain(VARIANT_A);
  });

  it('never sends another tenant\'s barcodes onto a device', async () => {
    const { service } = setup();
    const forA: any = await service.pull(contextFor(TENANT_A), BRANCH_A);
    expect(forA.products.flatMap((p: any) => p.barcodes.map((b: any) => b.code))).toEqual(['A-CODE']);
  });

  it('binds the calling tenant (and branch) on every change-stream read', async () => {
    const { service, rawCalls } = setup();
    await service.pull(contextFor(TENANT_A), BRANCH_A, { cursor: '0:0' });
    const read = rawCalls.find((call) => call.sql.includes('ORDER BY "txid", "sequence"'))!;

    expect(read.sql).toContain('"tenant_id" =');
    expect(read.values).toContain(TENANT_A);
    expect(read.values).toContain(BRANCH_A);
    expect(read.values).not.toContain(TENANT_B);
  });

  it('does not return another tenant\'s stock for a foreign branch', async () => {
    const { service } = setup();
    const forA: any = await service.pull(contextFor(TENANT_A), BRANCH_B);
    expect(forA.stock).toEqual([]);
  });
});
