import { randomUUID } from 'crypto';
import { SalesService } from './sales.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { PricingService } from '../pricing/pricing.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { SalesTaxSnapshotService } from '../tax/sales-tax-snapshot.service';

/**
 * BR-CST-101 / Permission Matrix §17 §51 — the `sales` counterpart of the
 * masking pinned in `overrides.service.spec.ts` and
 * `offers.cost-visibility.spec.ts`.
 *
 * This one differs from those in a way worth stating: it is **a live leak, not
 * hardening**. `SalesInvoiceItem.unit_cost` is `ProductVariant.cost_price`
 * copied verbatim at the moment of sale — not a floor that happens to resolve
 * to cost — and `GET /sales/:id` clears on `sales.sale.view`, which `cashier`
 * holds. `sales.sale.view-cost-margin`, the key the Matrix gives that
 * disclosure, is granted to `tenant_owner`/`location_manager` only. So before
 * this gate a till could read exact cost for every line it had ever sold, plus
 * today's `cost_price` through the joined variant.
 *
 * The `hasPermission` double drives the gate directly, exactly as the offers
 * spec does — the point under test is the projection, not the catalog.
 */

const ctx = contextFor(TENANT_A);
const BRANCH_ID = randomUUID();
const VARIANT_ID = randomUUID();
const UNIT_PRICE = 150;
/** The figure that must not reach a till: cost at the moment of sale. */
const UNIT_COST = 100;
/** The second disclosure on the same payload: cost *today*, via the joined variant. */
const VARIANT_COST_PRICE = 110;

function actor(overrides: Record<string, unknown> = {}) {
  return {
    sub: randomUUID(),
    role: 'owner',
    branch_id: BRANCH_ID,
    membership_role: 'cashier',
    capabilities: [],
    ...overrides,
  } as any;
}

function invoiceFixture() {
  return {
    id: 'sale-1',
    invoice_number: 'INV-1',
    branch_id: BRANCH_ID,
    total: 450,
    occurred_at: new Date(),
    items: [
      {
        id: 'sale-item-1',
        variant_id: VARIANT_ID,
        qty: 3,
        unit_price: UNIT_PRICE,
        unit_cost: UNIT_COST,
        unit_tax: 21,
        sku_snapshot: 'SKU-1',
        variant: {
          id: VARIANT_ID,
          sku: 'SKU-1',
          cost_price: VARIANT_COST_PRICE,
          product: { name_en: 'Shirt', name_ar: 'قميص' },
        },
        // The third join carrying the same figure: the completed returns
        // hanging off this line, reached without going through
        // `original_returns`. Non-empty on purpose — an empty array makes
        // every assertion about it pass vacuously.
        return_items: [
          {
            id: 'return-item-1',
            qty: 1,
            unit_price: UNIT_PRICE,
            unit_cost: UNIT_COST,
          },
        ],
      },
    ],
    original_returns: [
      {
        id: 'return-1',
        refund_total: 150,
        items: [
          {
            id: 'return-item-1',
            variant_id: VARIANT_ID,
            qty: 1,
            unit_price: UNIT_PRICE,
            unit_cost: UNIT_COST,
            unit_tax: 7,
          },
        ],
      },
    ],
  };
}

function setup(hasCostMargin: boolean) {
  const prisma = {
    salesInvoice: { findFirst: jest.fn().mockResolvedValue(invoiceFixture()) },
  };
  const costVisibility = new CostVisibilityService({
    hasPermission: async () => hasCostMargin,
  } as unknown as PermissionPolicyService);
  return {
    prisma,
    service: new SalesService(prisma as any, {} as unknown as PricingService, costVisibility, new SalesTaxSnapshotService()),
  };
}

describe('SalesService.getInvoice — sale-line cost is never disclosed without sales.sale.view-cost-margin', () => {
  it('strips unit_cost from every sale line for an actor without the key', async () => {
    const { service } = setup(false);
    const invoice: any = await service.getInvoice(ctx, 'sale-1', actor());

    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0]).not.toHaveProperty('unit_cost');
    // The line survives intact otherwise — this masks a field, not the invoice.
    expect(Number(invoice.items[0].unit_price)).toBe(UNIT_PRICE);
    expect(invoice.items[0].qty).toBe(3);
    expect(invoice.items[0].sku_snapshot).toBe('SKU-1');
  });

  it('strips cost_price from the joined variant, the same cost under another key', async () => {
    const { service } = setup(false);
    const invoice: any = await service.getInvoice(ctx, 'sale-1', actor());

    expect(invoice.items[0].variant).toBeDefined();
    expect(invoice.items[0].variant).not.toHaveProperty('cost_price');
    // Dropping the whole join would break the receipt; only the cost goes.
    expect(invoice.items[0].variant.sku).toBe('SKU-1');
    expect(invoice.items[0].variant.product.name_en).toBe('Shirt');
  });

  it('strips unit_cost from the return_items joined onto each line', async () => {
    const { service } = setup(false);
    const invoice: any = await service.getInvoice(ctx, 'sale-1', actor());

    expect(invoice.items[0].return_items).toHaveLength(1);
    expect(invoice.items[0].return_items[0]).not.toHaveProperty('unit_cost');
    // The join exists so the UI can show how much of the line came back.
    expect(invoice.items[0].return_items[0].qty).toBe(1);
  });

  it('strips unit_cost from the returns carried on the same invoice', async () => {
    const { service } = setup(false);
    const invoice: any = await service.getInvoice(ctx, 'sale-1', actor());

    expect(invoice.original_returns[0].items).toHaveLength(1);
    expect(invoice.original_returns[0].items[0]).not.toHaveProperty('unit_cost');
    expect(Number(invoice.original_returns[0].items[0].unit_price)).toBe(UNIT_PRICE);
    expect(Number(invoice.original_returns[0].refund_total)).toBe(150);
  });

  it('returns every cost field to an actor holding the key', async () => {
    const { service } = setup(true);
    const invoice: any = await service.getInvoice(ctx, 'sale-1', actor({ membership_role: 'location_manager' }));

    expect(Number(invoice.items[0].unit_cost)).toBe(UNIT_COST);
    expect(Number(invoice.items[0].variant.cost_price)).toBe(VARIANT_COST_PRICE);
    expect(Number(invoice.original_returns[0].items[0].unit_cost)).toBe(UNIT_COST);
  });

  it('masks when the actor has no membership_role at all', async () => {
    // `GET /sales/:id/pdf` carries no `@RequirePermission`, so `PermissionGuard`
    // never runs its fail-closed membership check and this handler can be
    // reached without the claim. The gate must deny rather than throw.
    const { service } = setup(true);
    const invoice: any = await service.getInvoice(ctx, 'sale-1', actor({ membership_role: undefined }));

    expect(invoice.items[0]).not.toHaveProperty('unit_cost');
    expect(invoice.items[0].variant).not.toHaveProperty('cost_price');
  });

  it('leaves the stored row untouched — the projection is on the response only', async () => {
    const { prisma, service } = setup(false);
    await service.getInvoice(ctx, 'sale-1', actor());

    // The query still selects cost; the margin reports read these same rows
    // behind their own `reports.*.view-cost-margin` guard.
    const stored = await prisma.salesInvoice.findFirst.mock.results[0].value;
    expect(Number(stored.items[0].unit_cost)).toBe(UNIT_COST);
  });
});
