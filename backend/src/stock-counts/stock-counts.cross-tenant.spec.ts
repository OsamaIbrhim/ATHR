import { randomUUID } from 'crypto';
import { StockCountsService } from './stock-counts.service';
import { StockCountScansService } from './stock-count-scans.service';
import { StockCountsReadService } from './stock-counts.read.service';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aBranch } from '../identity/testing/fixture-builders';

/** Cross-tenant and cross-branch isolation of stock counts. */

const COUNT_A = randomUUID();
const COUNT_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_A2 = randomUUID();
const BRANCH_B = randomUUID();
const CATEGORY_B = randomUUID();

const count = (id: string, tenant_id: string, branch_id: string) => ({
  id,
  tenant_id,
  branch_id,
  warehouse_id: randomUUID(),
  count_number: `CNT-${id.slice(0, 6)}`,
  name: 'count',
  status: 'open',
  scope_type: 'all',
  category_id: null,
  product_type_id: null,
  scope_key: 'all',
  uncounted_choice: null,
  started_by: null,
  posted_by: null,
  posted_at: null,
  cancelled_by: null,
  cancelled_at: null,
  created_at: new Date(),
  updated_at: new Date(),
});

function setup() {
  const prisma = fakePrisma({
    stockCount: [count(COUNT_A, TENANT_A, BRANCH_A), count(COUNT_B, TENANT_B, BRANCH_B)],
    stockCountLine: [],
    stockCountEntry: [],
    branch: [aBranch({ id: BRANCH_A, tenant_id: TENANT_A }), aBranch({ id: BRANCH_A2, tenant_id: TENANT_A }), aBranch({ id: BRANCH_B, tenant_id: TENANT_B })],
    category: [{ id: CATEGORY_B, tenant_id: TENANT_B, name_ar: 'foreign' }],
    productType: [],
    user: [],
    auditLog: [],
  });
  const captured: string[] = [];
  prisma.$queryRaw = async (query: any) => {
    captured.push(Array.isArray(query) ? query.join('?') : String(query?.sql ?? query?.strings?.join('?') ?? query));
    return [];
  };
  prisma.$executeRaw = async () => 1;
  prisma.$transaction = async (fn: any) => fn(prisma);
  const reads = new StockCountsReadService(prisma);
  return {
    prisma,
    captured,
    reads,
    scans: new StockCountScansService(prisma),
    service: new StockCountsService(prisma, { defaultWarehouseId: async () => randomUUID() } as any, reads),
  };
}

const tenantWide = () => actorFor('tenant_owner', { sub: randomUUID(), tenantWide: true });

describe('stock counts — cross-tenant isolation', () => {
  it('does not return another tenant\'s count', async () => {
    const { reads } = setup();
    await expect(reads.get(contextFor(TENANT_B), COUNT_A, tenantWide())).rejects.toThrow('Stock count not found');
    await expect(reads.review(contextFor(TENANT_B), COUNT_A, { page: 1, page_size: 50 } as any, tenantWide())).rejects.toThrow('Stock count not found');
    await expect(reads.recent(contextFor(TENANT_B), COUNT_A, { page: 1, page_size: 50 } as any, tenantWide())).rejects.toThrow('Stock count not found');
  });

  it('hides a count of another branch from a branch-scoped user', async () => {
    const { reads } = setup();
    const scoped = actorFor('warehouse_manager', { sub: randomUUID(), branchId: BRANCH_A2 });
    await expect(reads.get(contextFor(TENANT_A), COUNT_A, scoped)).rejects.toThrow('Stock count not found');
  });

  it('never lets a step touch another tenant\'s count: the lock binds the tenant and finds nothing', async () => {
    const { service, scans, captured } = setup();
    const foreign = contextFor(TENANT_B);
    await expect(service.cancel(foreign, COUNT_A, {}, tenantWide())).rejects.toThrow('Stock count not found');
    await expect(service.post(foreign, COUNT_A, {} as any, tenantWide())).rejects.toThrow('Stock count not found');
    await expect(scans.record(foreign, COUNT_A, { entries: [{ entry_id: 'entry-00000001', barcode: '1' }] }, tenantWide())).rejects.toThrow('Stock count not found');
    await expect(scans.resetLine(foreign, COUNT_A, randomUUID(), tenantWide())).rejects.toThrow('Stock count not found');
    const locks = captured.filter((sql) => sql.includes('FROM "StockCount"') && /FOR (UPDATE|SHARE)/.test(sql));
    expect(locks).toHaveLength(4);
    for (const sql of locks) expect(sql).toMatch(/"tenant_id" =/);
  });

  it('refuses another tenant\'s branch and category as the scope of a new count', async () => {
    const { service } = setup();
    const dto = (branch_id: string, scope: any) => ({ branch_id, scope }) as any;
    await expect(service.start(contextFor(TENANT_A), dto(BRANCH_B, { type: 'all' }), tenantWide())).rejects.toThrow('Branch not found');
    await expect(
      service.start(contextFor(TENANT_A), dto(BRANCH_A, { type: 'category', id: CATEGORY_B }), tenantWide()),
    ).rejects.toMatchObject({ response: { code: 'STOCK_COUNT_SCOPE_NOT_FOUND' } });
  });

  it('lists only the calling tenant\'s counts', async () => {
    const { reads, prisma } = setup();
    prisma.stockCount.groupBy = async () => [];
    prisma.stockCountLine.groupBy = async () => [];
    prisma.stockCountEntry.groupBy = async () => [];
    const a = await reads.list(contextFor(TENANT_A), { page: 1, page_size: 50 } as any, tenantWide());
    expect(a.items.map((item: any) => item.id)).toEqual([COUNT_A]);
  });
});
