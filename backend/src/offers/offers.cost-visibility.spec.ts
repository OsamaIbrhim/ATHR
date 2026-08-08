import { randomUUID } from 'crypto';
import { OffersService } from './offers.service';
import { PricingService } from '../pricing/pricing.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * BR-CST-101 / Permission Matrix §17 §51 — the `offers` counterpart of the B3
 * masking already pinned in `overrides.service.spec.ts`.
 *
 * `OfferSuggestion.min_allowed_price` is the quote's floor, and an entry with
 * no explicit `floor_price` (every migrated entry) resolves that floor to the
 * variant's `cost_price`. The fixture below sets `floor_price: null` so the
 * field under test really is cost (50), not an arbitrary number.
 *
 * What these tests pin is the *mechanism*: the offers read path is routed
 * through the cost-visibility gate. They deliberately do not claim a live leak
 * — both roles that clear this endpoint's guards today (`tenant_owner`,
 * `location_manager`) hold `pricing.cost.view`, so a freshly-seeded
 * environment masks nothing. The `hasPermission: false` double stands in for
 * any role that does not, which is what the gate exists to handle.
 */

const ctx = contextFor(TENANT_A);
const VARIANT_ID = randomUUID();
const BRANCH_ID = randomUUID();
const COST_PRICE = 50;

function actor(overrides: Record<string, unknown> = {}) {
  return {
    sub: randomUUID(),
    role: 'branch_manager',
    branch_id: BRANCH_ID,
    membership_role: 'location_manager',
    capabilities: [],
    ...overrides,
  } as any;
}

/** `hasCostView` drives the gate directly — see the block comment above. */
function setup(options: { hasCostView: boolean; existingSuggestion?: boolean } = { hasCostView: false }) {
  const prisma = fakePrisma(
    {
      inventoryStock: options.existingSuggestion
        ? []
        : [
            {
              id: randomUUID(),
              tenant_id: TENANT_A,
              branch_id: BRANCH_ID,
              variant_id: VARIANT_ID,
              qty_on_hand: 7,
              // Comfortably past the 90-day slow-mover cutoff.
              last_sold_at: new Date(Date.now() - 200 * 86400000),
            },
          ],
      offerSuggestion: options.existingSuggestion
        ? [
            {
              id: randomUUID(),
              tenant_id: TENANT_A,
              branch_id: BRANCH_ID,
              variant_id: VARIANT_ID,
              status: 'pending',
              days_unsold: 200,
              current_price: 100,
              suggested_price: 90,
              min_allowed_price: COST_PRICE,
            },
          ]
        : [],
      productVariant: [
        {
          id: VARIANT_ID,
          tenant_id: TENANT_A,
          product_id: randomUUID(),
          cost_price: COST_PRICE,
          product: { category_id: null, brand_id: null },
        },
      ],
      priceBook: [{ id: 'book-1', tenant_id: TENANT_A, status: 'active', is_default: true }],
      priceBookEntry: [
        {
          id: 'entry-1',
          tenant_id: TENANT_A,
          price_book_id: 'book-1',
          scope_type: 'global',
          scope_id: null,
          min_qty: 1,
          unit_price: 100,
          allow_zero_price: false,
          tax_percent: 0,
          // The post-migration state: no explicit floor, so the floor IS cost.
          floor_price: null,
          effective_from: new Date(0),
          effective_to: null,
          status: 'active',
        },
      ],
      auditLog: [],
    },
    { priceBookEntry: { price_book: { table: 'priceBook', localKey: 'price_book_id' } } },
  );
  const costVisibility = new CostVisibilityService({
    hasPermission: async () => options.hasCostView,
  } as unknown as PermissionPolicyService);
  return { prisma, service: new OffersService(prisma, new PricingService(prisma), costVisibility) };
}

describe('OffersService — the suggestion floor is never disclosed without cost/margin visibility', () => {
  it('strips min_allowed_price from a freshly generated suggestion', async () => {
    const { service } = setup({ hasCostView: false });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('min_allowed_price');
    // The rest of the suggestion is untouched — this masks a field, not the feature.
    expect(rows[0].days_unsold).toBe(200);
    expect(rows[0].qty).toBe(7);
  });

  it('returns min_allowed_price to an actor holding cost/margin visibility', async () => {
    const { service } = setup({ hasCostView: true });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].min_allowed_price)).toBe(COST_PRICE);
  });

  it('still persists the true floor for audit even when the response masks it', async () => {
    const { prisma, service } = setup({ hasCostView: false });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(rows[0]).not.toHaveProperty('min_allowed_price');
    expect(prisma.offerSuggestion.rows).toHaveLength(1);
    // Written value is the unmasked cost-derived floor: audit is not disclosure.
    expect(Number(prisma.offerSuggestion.rows[0].min_allowed_price)).toBe(COST_PRICE);
  });

  it('strips min_allowed_price from an already-pending suggestion on the read path', async () => {
    const { service } = setup({ hasCostView: false, existingSuggestion: true });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('min_allowed_price');
  });

  it('strips min_allowed_price from the review response too (same row, same field)', async () => {
    const { prisma, service } = setup({ hasCostView: false, existingSuggestion: true });
    const pendingId = prisma.offerSuggestion.rows[0].id;

    const reviewed: any = await service.review(ctx, pendingId, 'approved', actor());

    expect(reviewed.status).toBe('approved');
    expect(reviewed).not.toHaveProperty('min_allowed_price');
    expect(Number(prisma.offerSuggestion.rows[0].min_allowed_price)).toBe(COST_PRICE);
  });

  it('returns min_allowed_price on review for an actor holding cost/margin visibility', async () => {
    const { prisma, service } = setup({ hasCostView: true, existingSuggestion: true });
    const pendingId = prisma.offerSuggestion.rows[0].id;

    const reviewed: any = await service.review(ctx, pendingId, 'approved', actor());

    expect(Number(reviewed.min_allowed_price)).toBe(COST_PRICE);
  });
});
