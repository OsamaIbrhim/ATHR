import { ReportsController } from './reports.controller';
import { actorFor } from '../auth/testing/actors';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// Controller methods take the resolved TenantContext first.
const ctx = contextFor(TENANT_A);

describe('ReportsController branch scope', () => {
  // A warehouse manager works across the tenant; a branch manager only in their branch.
  const warehouseManager = actorFor('warehouse_manager', { sub: 'warehouse-1', tenantWide: true });
  const branchManager = actorFor('location_manager', { sub: 'manager-1', branchId: 'branch-a' });

  function setup() {
    const reports = {
      sales: jest.fn().mockResolvedValue({ total_sales: 125 }),
      bestSellers: jest.fn(),
      profitByItem: jest.fn(),
      inventoryValuation: jest.fn(),
    };
    return {
      reports,
      controller: new ReportsController(reports as any, {} as any),
    };
  }

  it('lets a tenant-wide user read all branches or select one branch', async () => {
    const { controller, reports } = setup();

    await controller.sales(ctx, '2026-07-24', '2026-07-24', undefined, { user: warehouseManager } as any);
    await controller.sales(ctx, '2026-07-24', '2026-07-24', 'branch-b', { user: warehouseManager } as any);

    expect(reports.sales).toHaveBeenNthCalledWith(1, ctx, '2026-07-24', '2026-07-24', undefined);
    expect(reports.sales).toHaveBeenNthCalledWith(2, ctx, '2026-07-24', '2026-07-24', 'branch-b');
  });

  it('keeps a branch manager report scoped to the assigned branch', async () => {
    const { controller, reports } = setup();

    await controller.sales(ctx, '2026-07-24', '2026-07-24', undefined, { user: branchManager } as any);

    expect(reports.sales).toHaveBeenCalledWith(ctx, '2026-07-24', '2026-07-24', 'branch-a');
  });

  it('rejects a branch manager asking for another branch', async () => {
    const { controller } = setup();
    expect(() =>
      controller.sales(ctx, '2026-07-24', '2026-07-24', 'branch-b', { user: branchManager } as any),
    ).toThrow('You cannot access another branch');
  });
});
