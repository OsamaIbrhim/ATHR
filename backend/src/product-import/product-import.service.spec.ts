import { randomUUID } from 'crypto';
import { ProductImportService } from './product-import.service';
import { actorFor } from '../auth/testing/actors';
import { contextFor, TENANT_A } from '../identity/testing/cross-tenant-harness';

const BRANCH = randomUUID();

function setup(options: { taxCategory?: unknown; branch?: unknown; existingSkus?: string[]; remaining?: number | null } = {}) {
  const queries: string[] = [];
  const prisma: any = {
    branch: { findFirst: jest.fn(async () => ('branch' in options ? options.branch : { id: BRANCH })) },
    unitOfMeasure: { findMany: jest.fn(async () => []) },
    productType: { findMany: jest.fn(async () => []) },
    priceBook: { findFirst: jest.fn(), create: jest.fn() },
    tenant: { findUniqueOrThrow: jest.fn() },
    $queryRaw: jest.fn(async (strings: any) => {
      const text = Array.isArray(strings) ? strings.join('?') : String(strings?.strings?.join('?'));
      queries.push(text);
      return text.includes('FROM "ProductVariant"') ? (options.existingSkus ?? []).map((sku) => ({ id: randomUUID(), sku })) : [];
    }),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const inventory: any = { defaultWarehouseId: jest.fn(async () => randomUUID()), apply: jest.fn() };
  const limits: any = { headroom: jest.fn(async () => ({ limit: options.remaining ?? null, current: 0, remaining: options.remaining ?? null })) };
  const tax: any = { findDefaultCategory: jest.fn(async () => ('taxCategory' in options ? options.taxCategory : { id: randomUUID() })) };
  return { prisma, queries, inventory, service: new ProductImportService(prisma, inventory, limits, tax) };
}

const owner = () => actorFor('tenant_owner', { sub: randomUUID(), tenantWide: true });
const rows = (count: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: count }, (_, i) => ({ row_ref: i + 2, sku: `SKU-${i}`, barcode: `BC-${i}`, name: `Item ${i}`, price: 10, ...extra }));
const request = (over: Record<string, unknown> = {}) => ({ dry_run: true, price_tax_mode: 'inclusive', rows: rows(3), ...over }) as any;

describe('product import service', () => {
  it('needs the pricing keys (prices go live) and, for opening quantities, the post key', async () => {
    const { service } = setup();
    const noPricing = actorFor('warehouse_manager', { tenantWide: true });
    await expect(service.import(contextFor(TENANT_A), request(), noPricing)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    const noPost = actorFor('tenant_owner', { tenantWide: true, revoked: [] });
    (noPost.permissions as Set<string>).delete('inventory.adjustment.post');
    await expect(service.import(contextFor(TENANT_A), request({ branch_id: BRANCH, rows: rows(2, { opening_qty: 3 }) }), noPost)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('needs a branch of the tenant when a row carries an opening quantity', async () => {
    await expect(setup().service.import(contextFor(TENANT_A), request({ rows: rows(1, { opening_qty: 2 }) }), owner())).rejects.toMatchObject({
      response: { code: 'IMPORT_BRANCH_REQUIRED' },
    });
    await expect(setup({ branch: null }).service.import(contextFor(TENANT_A), request({ branch_id: BRANCH, rows: rows(1, { opening_qty: 2 }) }), owner())).rejects.toThrow('Branch not found');
  });

  it('refuses to import when the tenant has no tax category', async () => {
    await expect(setup({ taxCategory: null }).service.import(contextFor(TENANT_A), request(), owner())).rejects.toMatchObject({ code: 'TAX_NO_ACTIVE_CODE' });
  });

  it('a dry run writes nothing and reads the catalogue in two statements however many rows there are', async () => {
    const small = setup();
    const big = setup();
    const a = await small.service.import(contextFor(TENANT_A), request({ rows: rows(3) }), owner());
    const b = await big.service.import(contextFor(TENANT_A), request({ rows: rows(1500) }), owner());

    expect(small.queries).toHaveLength(2);
    expect(big.queries).toHaveLength(2);
    for (const { prisma } of [small, big]) {
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.priceBook.create).not.toHaveBeenCalled();
    }
    expect(a).toMatchObject({ dry_run: true, summary: { total: 3, ready: 3, skipped: 0, failed: 0 } });
    expect(b.summary).toMatchObject({ total: 1500, ready: 1500 });
  });

  it('reports per row: bad cells fail only their row, existing SKUs are skipped, the plan limit stops the rest', async () => {
    const { service } = setup({ existingSkus: ['SKU-0'], remaining: 1 });
    const result = await service.import(
      contextFor(TENANT_A),
      request({ rows: [...rows(3), { row_ref: 9, sku: 'BAD', name: 'Bad', price: 'abc' }, { row_ref: 10, name: 'No identity', price: 1 }] }),
      owner(),
    );
    expect(result.rows.map((row: any) => `${row.index}:${row.status}:${row.errors[0]?.code ?? ''}`)).toEqual([
      '0:skipped:SKU_EXISTS',
      '1:ready:',
      '2:failed:ENTITLEMENT_LIMIT_REACHED',
      '3:failed:IMPORT_PRICE_INVALID',
      '4:failed:IMPORT_NO_IDENTITY',
    ]);
    expect(result.rows[3].row_ref).toBe(9);
    expect(result.summary).toMatchObject({ total: 5, ready: 1, skipped: 1, failed: 3, out_of_plan: 1 });
    expect(result.plan_limit).toEqual({ limit: 1, current: 0, remaining: 1 });
  });
});
