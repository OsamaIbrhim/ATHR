import { randomUUID } from 'crypto';
import { ReportsService } from './reports.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-007 Phase A §A.3.6 — cross-tenant isolation for the `reports` module.
 *
 * Reports are pure aggregates, so a missing tenant predicate does not throw
 * or leak a row id — it silently returns another tenant's revenue as part of
 * this tenant's totals. These assertions are on the numbers for that reason.
 */

const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();
const VARIANT = randomUUID();

function setup() {
  const inWindow = new Date('2026-03-15T10:00:00.000Z');
  const prisma = fakePrisma({
    salesInvoice: [
      {
        id: randomUUID(),
        tenant_id: TENANT_A,
        branch_id: BRANCH_A,
        status: 'completed',
        occurred_at: inWindow,
        total: 100,
        subtotal: 90,
        tax_amount: 10,
        items: [{ variant_id: VARIANT, qty: 1, unit_cost: 40, unit_price: 90 }],
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_B,
        branch_id: BRANCH_B,
        status: 'completed',
        occurred_at: inWindow,
        total: 7777,
        subtotal: 7000,
        tax_amount: 777,
        items: [{ variant_id: VARIANT, qty: 5, unit_cost: 10, unit_price: 1400 }],
      },
    ],
    return: [],
    salesInvoiceItem: [],
    returnItem: [],
    inventoryStock: [
      {
        tenant_id: TENANT_A,
        branch_id: BRANCH_A,
        variant_id: VARIANT,
        qty_on_hand: 2,
        variant: { sku: 'S1', cost_price: 40, product: { name_en: 'A' } },
        branch: { name_ar: 'A' },
      },
      {
        tenant_id: TENANT_B,
        branch_id: BRANCH_B,
        variant_id: VARIANT,
        qty_on_hand: 100,
        variant: { sku: 'S1', cost_price: 10, product: { name_en: 'B' } },
        branch: { name_ar: 'B' },
      },
    ],
  }, {
    // Lets the nested `invoice: { tenant_id }` / `return_record: { tenant_id }`
    // predicates actually be evaluated rather than silently ignored.
    salesInvoiceItem: { invoice: { table: 'salesInvoice', localKey: 'sales_invoice_id' } },
    returnItem: { return_record: { table: 'return', localKey: 'return_id' } },
  });
  return { prisma, service: new ReportsService(prisma) };
}

describe('reports — cross-tenant isolation', () => {
  it('reports only the calling tenant\'s sales totals', async () => {
    const { service } = setup();
    const forA: any = await service.sales(contextFor(TENANT_A), '2026-03-01', '2026-03-31');
    const forB: any = await service.sales(contextFor(TENANT_B), '2026-03-01', '2026-03-31');

    // 100, not 7877 — tenant B's revenue must not appear in tenant A's report.
    expect(Number(forA.gross_sales ?? forA.total_sales)).toBe(100);
    expect(Number(forB.gross_sales ?? forB.total_sales)).toBe(7777);
  });

  it('values only the calling tenant\'s inventory', async () => {
    const { service } = setup();
    const forA: any = await service.inventoryValuation(contextFor(TENANT_A));
    const rows = forA.rows ?? forA.items ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].branch).toBe('A');
  });

  it('does not attribute another tenant\'s best sellers', async () => {
    const { service, prisma } = setup();
    prisma.salesInvoiceItem.rows = [
      {
        tenant_id: TENANT_A,
        variant_id: VARIANT,
        qty: 1,
        unit_cost: 40,
        unit_price: 90,
        invoice: { tenant_id: TENANT_A, status: 'completed', branch_id: BRANCH_A },
        variant: { id: VARIANT, product: { name_en: 'A widget' } },
      },
      {
        tenant_id: TENANT_B,
        variant_id: VARIANT,
        qty: 500,
        unit_cost: 10,
        unit_price: 1400,
        invoice: { tenant_id: TENANT_B, status: 'completed', branch_id: BRANCH_B },
        variant: { id: VARIANT, product: { name_en: 'B widget' } },
      },
    ];

    const forA: any = await service.bestSellers(contextFor(TENANT_A));
    expect(forA).toHaveLength(1);
    expect(forA[0].qty).toBe(1);
  });
});
