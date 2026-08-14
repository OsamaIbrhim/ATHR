import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { OffersService } from './offers.service';
import { PricingService } from '../pricing/pricing.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { aProductVariant, aTaxCategory, aTaxCode, anInventoryStock, taxCategoryIdFor } from '../identity/testing/fixture-builders';
import { TaxResolutionService } from '../tax/tax-resolution.service';

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
const UNIT_PRICE = 100;
/** Floor loses the max: suggested = max(50, 100 x 0.90) = 90, strictly above cost. */
const COST_PRICE = 50;
/** Floor wins the max: suggested = max(95, 100 x 0.90) = 95, i.e. cost exactly. */
const CLAMPING_COST_PRICE = 95;

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
function setup(
  options: { hasCostView: boolean; existingSuggestion?: boolean; costPrice?: number } = {
    hasCostView: false,
  },
) {
  const cost = options.costPrice ?? COST_PRICE;
  // Mirrors the service's own max(floor, current x 0.90), so the pre-existing
  // row is consistent with what a fresh generation would have written.
  const persistedSuggested = Math.max(cost, UNIT_PRICE * 0.9);
  const prisma = fakePrisma(
    {
      taxCategory: [aTaxCategory({ tenant_id: TENANT_A })],
      taxCode: [aTaxCode({ tenant_id: TENANT_A, rate: new Prisma.Decimal(0) })],
      inventoryStock: options.existingSuggestion
        ? []
        : [
            anInventoryStock({
              tenant_id: TENANT_A,
              branch_id: BRANCH_ID,
              variant_id: VARIANT_ID,
              qty_on_hand: 7,
              // Comfortably past the 90-day slow-mover cutoff.
              last_sold_at: new Date(Date.now() - 200 * 86400000),
            }),
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
              current_price: UNIT_PRICE,
              suggested_price: persistedSuggested,
              min_allowed_price: cost,
            },
          ]
        : [],
      productVariant: [
        aProductVariant({
          id: VARIANT_ID,
          tenant_id: TENANT_A,
          cost_price: new Prisma.Decimal(cost),
          // Pre-hydrated relation: `quote()` walks `variant.product.brand_id`/`.category_id`.
          product: { category_id: null, brand_id: null, tax_category_id: taxCategoryIdFor(TENANT_A) },
        }),
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
          unit_price: UNIT_PRICE,
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
  return { prisma, service: new OffersService(prisma, new PricingService(prisma, new TaxResolutionService(prisma)), costVisibility) };
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

/**
 * The second disclosure on the same row. `suggested_price` is
 * `max(min_allowed_price, current_price x 0.90)`, so whenever the floor wins
 * that max the field *is* cost — stripping only `min_allowed_price` would have
 * left the exact number in the response under a different key.
 *
 * `CLAMPING_COST_PRICE` (95) makes the floor win against `100 x 0.90 = 90`;
 * `COST_PRICE` (50) makes it lose. The gate must distinguish the two.
 */
describe('OffersService — suggested_price is masked only where it equals the cost-derived floor', () => {
  it('strips suggested_price when it clamped to the floor and the actor lacks visibility', async () => {
    const { service } = setup({ hasCostView: false, costPrice: CLAMPING_COST_PRICE });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('suggested_price');
    expect(rows[0]).not.toHaveProperty('min_allowed_price');
    // Everything that does not disclose cost survives — this masks fields, not the row.
    expect(Number(rows[0].current_price)).toBe(UNIT_PRICE);
    expect(rows[0].days_unsold).toBe(200);
  });

  it('strips suggested_price from an already-pending clamped suggestion on the read path', async () => {
    const { service } = setup({
      hasCostView: false,
      existingSuggestion: true,
      costPrice: CLAMPING_COST_PRICE,
    });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('suggested_price');
  });

  it('returns a clamped suggested_price to an actor holding cost/margin visibility', async () => {
    const { service } = setup({ hasCostView: true, costPrice: CLAMPING_COST_PRICE });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(Number(rows[0].suggested_price)).toBe(CLAMPING_COST_PRICE);
    expect(Number(rows[0].min_allowed_price)).toBe(CLAMPING_COST_PRICE);
  });

  it('keeps suggested_price on the current_price x 0.90 branch even without visibility', async () => {
    const { service } = setup({ hasCostView: false });
    const rows: any[] = await service.suggestions(ctx, actor());

    // 90 is derived from current_price alone, which the caller already holds.
    expect(Number(rows[0].suggested_price)).toBe(90);
    expect(rows[0]).not.toHaveProperty('min_allowed_price');
  });

  it('keeps suggested_price on the x 0.90 branch for an actor holding visibility too', async () => {
    const { service } = setup({ hasCostView: true });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(Number(rows[0].suggested_price)).toBe(90);
  });

  it('persists the true clamped suggested_price even when the response masks it', async () => {
    const { prisma, service } = setup({ hasCostView: false, costPrice: CLAMPING_COST_PRICE });
    const rows: any[] = await service.suggestions(ctx, actor());

    expect(rows[0]).not.toHaveProperty('suggested_price');
    expect(prisma.offerSuggestion.rows).toHaveLength(1);
    expect(Number(prisma.offerSuggestion.rows[0].suggested_price)).toBe(CLAMPING_COST_PRICE);
    expect(Number(prisma.offerSuggestion.rows[0].min_allowed_price)).toBe(CLAMPING_COST_PRICE);
  });

  it('strips a clamped suggested_price from the review response but audits the true value', async () => {
    const { prisma, service } = setup({
      hasCostView: false,
      existingSuggestion: true,
      costPrice: CLAMPING_COST_PRICE,
    });
    const pendingId = prisma.offerSuggestion.rows[0].id;

    const reviewed: any = await service.review(ctx, pendingId, 'approved', actor());

    expect(reviewed.status).toBe('approved');
    expect(reviewed).not.toHaveProperty('suggested_price');
    // Audit is not disclosure: both the row and the audit entry keep the truth.
    expect(Number(prisma.offerSuggestion.rows[0].suggested_price)).toBe(CLAMPING_COST_PRICE);
    expect(Number(prisma.auditLog.rows[0].meta.suggested_price)).toBe(CLAMPING_COST_PRICE);
  });

  it('returns a clamped suggested_price on review to an actor holding visibility', async () => {
    const { prisma, service } = setup({
      hasCostView: true,
      existingSuggestion: true,
      costPrice: CLAMPING_COST_PRICE,
    });
    const pendingId = prisma.offerSuggestion.rows[0].id;

    const reviewed: any = await service.review(ctx, pendingId, 'approved', actor());

    expect(Number(reviewed.suggested_price)).toBe(CLAMPING_COST_PRICE);
  });
});
