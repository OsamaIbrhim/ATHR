import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { AdjustmentsService } from './adjustments.service';
import { AdjustmentsReadService } from './adjustments.read.service';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aBranch, aProductVariant } from '../identity/testing/fixture-builders';

/** Cross-tenant and cross-branch isolation of stock adjustments. */

const DOC_A = randomUUID();
const DOC_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_A2 = randomUUID();
const BRANCH_B = randomUUID();
const WAREHOUSE_A = randomUUID();
const WAREHOUSE_B = randomUUID();
const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();

const doc = (id: string, tenant_id: string, branch_id: string, warehouse_id: string) => ({
  id,
  tenant_id,
  branch_id,
  warehouse_id,
  adjustment_number: `ADJ-${id.slice(0, 6)}`,
  status: 'draft',
  note: null,
  created_by: null,
  approved_by: null,
  approved_at: null,
  posted_by: null,
  posted_at: null,
  cancelled_by: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: new Date(),
  updated_at: new Date(),
});

function setup() {
  const prisma = fakePrisma({
    stockAdjustment: [doc(DOC_A, TENANT_A, BRANCH_A, WAREHOUSE_A), doc(DOC_B, TENANT_B, BRANCH_B, WAREHOUSE_B)],
    stockAdjustmentItem: [
      { id: randomUUID(), tenant_id: TENANT_A, adjustment_id: DOC_A, variant_id: VARIANT_A, qty_delta: new Prisma.Decimal(-1), reason_code: 'damaged', note: null, qty_before: null, qty_after: null, unit_cost: null, value: null },
      { id: randomUUID(), tenant_id: TENANT_B, adjustment_id: DOC_B, variant_id: VARIANT_B, qty_delta: new Prisma.Decimal(5), reason_code: 'correction', note: null, qty_before: null, qty_after: null, unit_cost: null, value: null },
    ],
    branch: [aBranch({ id: BRANCH_A, tenant_id: TENANT_A }), aBranch({ id: BRANCH_A2, tenant_id: TENANT_A }), aBranch({ id: BRANCH_B, tenant_id: TENANT_B })],
    productVariant: [aProductVariant({ id: VARIANT_A, tenant_id: TENANT_A }), aProductVariant({ id: VARIANT_B, tenant_id: TENANT_B })],
    product: [],
    inventoryStock: [],
    user: [],
    auditLog: [],
  });
  const captured: string[] = [];
  prisma.$queryRaw = async (query: any) => {
    captured.push(Array.isArray(query) ? query.join('?') : String(query?.sql ?? query));
    return [];
  };
  prisma.$executeRaw = async () => 1;
  prisma.$transaction = async (fn: any) => fn(prisma);
  prisma.stockAdjustment.groupBy = async () => [];
  const reads = new AdjustmentsReadService(prisma);
  const service = new AdjustmentsService(prisma, {} as any, reads);
  return { prisma, captured, reads, service };
}

const tenantWide = () => actorFor('tenant_owner', { sub: randomUUID(), tenantWide: true });

describe('stock adjustments — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s documents', async () => {
    const { reads } = setup();
    const a = await reads.list(contextFor(TENANT_A), { page: 1, page_size: 50 } as any, tenantWide());
    expect(a.items.map((item: any) => item.id)).toEqual([DOC_A]);
    const b = await reads.list(contextFor(TENANT_B), { page: 1, page_size: 50 } as any, tenantWide());
    expect(b.items.map((item: any) => item.id)).toEqual([DOC_B]);
  });

  it('does not return another tenant\'s document by id', async () => {
    const { reads } = setup();
    await expect(reads.get(contextFor(TENANT_B), DOC_A, tenantWide())).rejects.toThrow('Stock adjustment not found');
  });

  it('hides a document of another branch from a branch-scoped user', async () => {
    const { reads } = setup();
    const scoped = actorFor('warehouse_manager', { sub: randomUUID(), branchId: BRANCH_A2 });
    await expect(reads.get(contextFor(TENANT_A), DOC_A, scoped)).rejects.toThrow('Stock adjustment not found');
  });

  it('never lets a step touch another tenant\'s document: the locking read binds the tenant and finds nothing', async () => {
    const { service, captured } = setup();
    for (const step of [
      () => service.approve(contextFor(TENANT_B), DOC_A, tenantWide()),
      () => service.post(contextFor(TENANT_B), DOC_A, tenantWide()),
      () => service.cancel(contextFor(TENANT_B), DOC_A, {}, tenantWide()),
      () => service.update(contextFor(TENANT_B), DOC_A, { lines: [{ variant_id: VARIANT_B, qty_delta: 1, reason_code: 'correction' }] } as any, tenantWide()),
    ]) {
      await expect(step()).rejects.toThrow('Stock adjustment not found');
    }
    const locks = captured.filter((sql) => sql.includes('FROM "StockAdjustment"') && sql.includes('FOR UPDATE'));
    expect(locks).toHaveLength(4);
    for (const sql of locks) expect(sql).toMatch(/"tenant_id" =/);
  });

  it('does not create a document in another tenant\'s branch', async () => {
    const { service } = setup();
    await expect(
      service.create(contextFor(TENANT_A), { branch_id: BRANCH_B, lines: [{ variant_id: VARIANT_A, qty_delta: 1, reason_code: 'correction' }] } as any, tenantWide()),
    ).rejects.toThrow('Branch not found');
  });

  it('hides cost columns from a reader without inventory.position.view-cost', async () => {
    const { reads } = setup();
    const noCost = actorFor('cashier', { sub: randomUUID(), tenantWide: true });
    const list = await reads.list(contextFor(TENANT_A), { page: 1, page_size: 50 } as any, noCost);
    expect(list.items[0]).not.toHaveProperty('net_value');
    const detail = await reads.get(contextFor(TENANT_A), DOC_A, noCost);
    expect(detail.items[0]).not.toHaveProperty('unit_cost');
    expect(detail.totals).not.toHaveProperty('net_value');
  });
});
