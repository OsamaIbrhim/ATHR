import { Prisma } from '@prisma/client';
import { ReportsService } from './reports.service';
import { TENANT_A, TENANT_B, contextFor } from '../identity/testing/cross-tenant-harness';

/**
 * WP-007 Phase A §A.3.6 — cross-tenant isolation for the `reports` module.
 *
 * Reports are SQL aggregates, so a missing tenant predicate would silently add
 * another tenant's revenue to the totals. The fake in-memory Prisma cannot run
 * those statements, so this pins that every one is issued with the calling
 * tenant bound and filtered on `tenant_id`; the numbers themselves are proven on
 * real Postgres by scripts/verify-raw-sql-tenant-scoping.cjs (R4).
 */
const zero = new Prisma.Decimal(0);

function setup() {
  const queryRaw = jest.fn().mockImplementation(() =>
    Promise.resolve([
      { variant_id: 'v', count: 0, total: 0, gross: zero, subtotal: zero, tax: zero, cost: zero, qty: zero, value: zero, revenue: zero, profit: zero },
    ]),
  );
  const prisma = {
    $queryRaw: queryRaw,
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    inventoryStock: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { queryRaw, prisma, service: new ReportsService(prisma as any) };
}

describe('reports — cross-tenant isolation', () => {
  it.each([
    ['sales', (s: ReportsService, tenant: string) => s.sales(contextFor(tenant), '2026-03-01', '2026-03-31')],
    ['best sellers', (s: ReportsService, tenant: string) => s.bestSellers(contextFor(tenant), '2026-03-01', '2026-03-31')],
    ['profit by item', (s: ReportsService, tenant: string) => s.profitByItem(contextFor(tenant), '2026-03-01', '2026-03-31')],
    ['inventory valuation', (s: ReportsService, tenant: string) => s.inventoryValuation(contextFor(tenant))],
  ])('%s binds only the calling tenant', async (_name, run) => {
    for (const [tenant, other] of [[TENANT_A, TENANT_B], [TENANT_B, TENANT_A]]) {
      const { service, queryRaw } = setup();
      await run(service, tenant);

      for (const [strings, ...parts] of queryRaw.mock.calls) {
        const { sql, values } = Prisma.sql(strings, ...parts); // flattens the nested fragments
        expect(values).toContain(tenant);
        expect(values).not.toContain(other);
        expect(sql).toContain('"tenant_id"');
      }
    }
  });

  it('values only the calling tenant\'s stock rows', async () => {
    const { service, prisma } = setup();
    await service.inventoryValuation(contextFor(TENANT_A));

    expect(prisma.inventoryStock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT_A }) }),
    );
  });
});
