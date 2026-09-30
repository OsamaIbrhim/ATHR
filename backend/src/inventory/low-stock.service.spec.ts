import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { LowStockService } from './low-stock.service';
import { InventoryController } from './inventory.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../identity/permission.guard';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aBranch } from '../identity/testing/fixture-builders';

const BRANCH = randomUUID();

function setup() {
  const prisma = fakePrisma({ branch: [aBranch({ id: BRANCH, tenant_id: TENANT_A })] });
  const captured: string[] = [];
  prisma.$queryRaw = async (query: any) => {
    captured.push(Array.isArray(query) ? query.join('?') : String(query?.strings?.join('?') ?? query?.sql ?? query));
    return [];
  };
  return { captured, service: new LowStockService(prisma) };
}

describe('low-stock lists', () => {
  it('is readable with inventory.position.view', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, InventoryController.prototype.listLowStock)).toEqual(['inventory.position.view']);
  });

  it('needs a branch for the list of items without a stock record', async () => {
    const { service } = setup();
    await expect(
      service.list(contextFor(TENANT_A), { page: 1, page_size: 50, status: 'no_stock_row' } as any, actorFor('tenant_owner', { tenantWide: true })),
    ).rejects.toMatchObject({ response: { code: 'BRANCH_REQUIRED' } });
  });

  it('binds the tenant into every statement it sends', async () => {
    const { service, captured } = setup();
    await service.list(contextFor(TENANT_A), { page: 1, page_size: 50, branch_id: BRANCH, status: 'no_stock_row' } as any, actorFor('tenant_owner', { tenantWide: true }));
    await service.list(contextFor(TENANT_A), { page: 1, page_size: 50, branch_id: BRANCH } as any, actorFor('tenant_owner', { tenantWide: true }));
    expect(captured.length).toBeGreaterThan(3);
    for (const sql of captured) expect(sql).toMatch(/"tenant_id" =/);
  });

  it('refuses a branch outside the user\'s access scope', async () => {
    const { service } = setup();
    const scoped = actorFor('warehouse_manager', { branchId: randomUUID() });
    await expect(service.list(contextFor(TENANT_A), { page: 1, page_size: 50, branch_id: BRANCH } as any, scoped)).rejects.toThrow('another branch');
  });
});
