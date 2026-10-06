import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAX_REPORT_SPAN_DAYS, ReportsService } from './reports.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// WP-007 Phase A: every report method takes a TenantContext first.
const ctx = contextFor(TENANT_A);
const D = (value: string) => new Prisma.Decimal(value);

/** The aggregation itself runs in Postgres (verify-raw-sql-tenant-scoping.cjs); these pin the app-side arithmetic and bounds. */
function serviceWith(rows: unknown[][]) {
  const queryRaw = jest.fn();
  for (const result of rows) queryRaw.mockResolvedValueOnce(result);
  return { service: new ReportsService({ $queryRaw: queryRaw } as any), queryRaw };
}

describe('ReportsService financial precision', () => {
  it('combines sales and returns without floating drift', async () => {
    const { service } = serviceWith([
      [{ count: 2, gross: D('0.30'), subtotal: D('0.25'), tax: D('0.05') }],
      [{ count: 1, total: D('0.10'), subtotal: D('0.07'), tax: D('0.03') }],
      [{ cost: D('0.06') }], // cost of goods sold net of returned goods
    ]);

    const report = await service.sales(ctx, '2026-07-01', '2026-07-01');

    expect(report).toEqual({
      count: 2,
      return_count: 1,
      gross_sales: 0.3,
      refunds: 0.1,
      total_sales: 0.2,
      net_revenue: 0.18,
      total_tax: 0.02,
      total_cost: 0.06,
      profit: 0.12,
    });
  });
});

describe('ReportsService bounds', () => {
  it('rejects a window longer than the maximum span before touching the database', async () => {
    const { service, queryRaw } = serviceWith([]);

    await expect(service.sales(ctx, '2025-01-01', '2026-12-31')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.bestSellers(ctx, '2025-01-01', '2026-12-31')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.profitByItem(ctx, '2025-01-01', '2026-12-31')).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(MAX_REPORT_SPAN_DAYS).toBe(366);
  });

  it('requires a date range', async () => {
    const { service } = serviceWith([]);
    await expect(service.bestSellers(ctx, undefined as any, undefined as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ReportsService tenant scoping', () => {
  it('binds the calling tenant in every aggregate query', async () => {
    const { service, queryRaw } = serviceWith([[], []]);
    await service.bestSellers(ctx, '2026-07-01', '2026-07-31').catch(() => undefined);

    const [strings, ...parts] = queryRaw.mock.calls[0];
    const { sql, values } = Prisma.sql(strings, ...parts);
    expect(values).toContain(TENANT_A);
    expect(sql).toContain('"tenant_id"');
  });
});
