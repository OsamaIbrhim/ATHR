import { PricingService, ResolvedPriceEntry } from './pricing.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

// WP-008 Phase B: PricingService resolves against active PriceBookEntry rows
// instead of the flat PricingRule formula. `qty=1`/no `qty` maps to the base
// (non-quantity-break) entry unless a test says otherwise.
const ctx = contextFor(TENANT_A);

const VARIANT_ID = 'variant-1';
const PRODUCT_ID = 'product-1';
const BRAND_ID = 'brand-1';
const CATEGORY_ID = 'category-1';

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: VARIANT_ID,
    product_id: PRODUCT_ID,
    cost_price: 85,
    product: { brand_id: BRAND_ID, category_id: CATEGORY_ID },
    ...overrides,
  };
}

function entry(overrides: Partial<ResolvedPriceEntry> & Pick<ResolvedPriceEntry, 'scope_type'>): ResolvedPriceEntry {
  return {
    id: `entry-${Math.random()}`,
    price_book_id: 'book-1',
    scope_id: null,
    min_qty: 1,
    unit_price: 100,
    allow_zero_price: false,
    tax_percent: 14,
    floor_price: null,
    ...overrides,
  };
}

describe('PricingService — deterministic price-source ordering (BR-PSL-100)', () => {
  const service = new PricingService({} as any);

  it('prefers a variant-scoped entry over every other level', () => {
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
      entry({ scope_type: 'brand', scope_id: BRAND_ID, unit_price: 30 }),
      entry({ scope_type: 'product', scope_id: PRODUCT_ID, unit_price: 40 }),
      entry({ scope_type: 'variant', scope_id: VARIANT_ID, unit_price: 50 }),
    ];
    expect(service.quote(variant(), entries)!.net_price).toBe(50);
  });

  it('falls back to product scope when no variant entry exists', () => {
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
      entry({ scope_type: 'brand', scope_id: BRAND_ID, unit_price: 30 }),
      entry({ scope_type: 'product', scope_id: PRODUCT_ID, unit_price: 40 }),
    ];
    expect(service.quote(variant(), entries)!.net_price).toBe(40);
  });

  it('falls back to brand scope when no variant/product entry exists', () => {
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
      entry({ scope_type: 'brand', scope_id: BRAND_ID, unit_price: 30 }),
    ];
    expect(service.quote(variant(), entries)!.net_price).toBe(30);
  });

  it('falls back to category scope when no variant/product/brand entry exists', () => {
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
    ];
    expect(service.quote(variant(), entries)!.net_price).toBe(20);
  });

  it('falls back to the global entry when nothing more specific exists', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 10 })];
    expect(service.quote(variant(), entries)!.net_price).toBe(10);
  });

  it('ignores entries scoped to a different variant/product/brand/category', () => {
    const entries = [
      entry({ scope_type: 'variant', scope_id: 'some-other-variant', unit_price: 999 }),
      entry({ scope_type: 'product', scope_id: 'some-other-product', unit_price: 999 }),
      entry({ scope_type: 'brand', scope_id: 'some-other-brand', unit_price: 999 }),
      entry({ scope_type: 'category', scope_id: 'some-other-category', unit_price: 999 }),
      entry({ scope_type: 'global', unit_price: 42 }),
    ];
    expect(service.quote(variant(), entries)!.net_price).toBe(42);
  });

  it('BR-PSL-101: returns null (no silent fallback) when no entry resolves at any level', () => {
    expect(service.quote(variant(), [])).toBeNull();
  });

  it('BR-PSL-101/CERR-200: calculate() blocks pricing with PRICING_NO_PRICE_AVAILABLE instead of a zero/default price', async () => {
    const prisma = {
      productVariant: { findFirst: jest.fn().mockResolvedValue(variant()) },
      priceBookEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await expect(new PricingService(prisma as any).calculate(ctx, VARIANT_ID)).rejects.toMatchObject({
      code: 'PRICING_NO_PRICE_AVAILABLE',
    });
  });

  it('computes tax_amount/selling_price/min_allowed_price from the winning entry', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 100, tax_percent: 14 })];
    const quote = service.quote(variant(), entries)!;
    expect(quote.net_price).toBe(100);
    expect(quote.tax_amount).toBe(14);
    expect(quote.selling_price).toBe(114);
    // No explicit floor_price on the entry -> cost-based fallback (BR-OVP-102).
    expect(quote.min_allowed_price).toBe(85);
  });

  it('uses the entry\'s explicit floor_price over the cost-based fallback', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 100, floor_price: 60 })];
    expect(service.quote(variant(), entries)!.min_allowed_price).toBe(60);
  });
});

describe('PricingService — quantity breaks (BR-PSL-104)', () => {
  const service = new PricingService({} as any);
  const entries = [
    entry({ scope_type: 'variant', scope_id: VARIANT_ID, min_qty: 1, unit_price: 100 }),
    entry({ scope_type: 'variant', scope_id: VARIANT_ID, min_qty: 10, unit_price: 90 }),
    entry({ scope_type: 'variant', scope_id: VARIANT_ID, min_qty: 50, unit_price: 80 }),
  ];

  it('uses the base entry below the first break', () => {
    expect(service.quote(variant(), entries, 1)!.net_price).toBe(100);
    expect(service.quote(variant(), entries, 9)!.net_price).toBe(100);
  });

  it('uses the tightest qualifying break at and above its threshold', () => {
    expect(service.quote(variant(), entries, 10)!.net_price).toBe(90);
    expect(service.quote(variant(), entries, 49)!.net_price).toBe(90);
    expect(service.quote(variant(), entries, 50)!.net_price).toBe(80);
    expect(service.quote(variant(), entries, 1000)!.net_price).toBe(80);
  });

  it('does not fall through to a lower-priority scope just because a qty break at a higher scope is missed', () => {
    const withGlobalFallback = [
      entry({ scope_type: 'variant', scope_id: VARIANT_ID, min_qty: 10, unit_price: 90 }),
      entry({ scope_type: 'global', min_qty: 1, unit_price: 10 }),
    ];
    // qty=1 doesn't qualify for the variant-level min_qty=10 entry, and the
    // variant scope has no min_qty=1 entry of its own -> the whole "variant"
    // level has no qualifying entry, so resolution correctly falls through
    // to "global" (not an error) at that lower quantity.
    expect(service.quote(variant(), withGlobalFallback, 1)!.net_price).toBe(10);
    expect(service.quote(variant(), withGlobalFallback, 10)!.net_price).toBe(90);
  });
});

describe('PricingService — calculateMany (BR-PSL-101 blocks the whole batch on any unpriced line)', () => {
  it('prices every line after one entry query', async () => {
    const prisma = {
      priceBookEntry: { findMany: jest.fn().mockResolvedValue([entry({ scope_type: 'global', unit_price: 100 })]) },
    };
    const service = new PricingService(prisma as any);
    const lines = Array.from({ length: 500 }, (_, index) => ({
      variant: variant({ id: `variant-${index}` }),
      qty: 1,
    }));

    const quotes = await service.calculateMany(ctx, lines);

    expect(prisma.priceBookEntry.findMany).toHaveBeenCalledTimes(1);
    expect(quotes.size).toBe(500);
    expect(quotes.get('variant-499')).toMatchObject({ net_price: 100, tax_amount: 14, selling_price: 114 });
  });

  it('throws listing every unpriced variant instead of completing the sale partially priced', async () => {
    const prisma = {
      priceBookEntry: { findMany: jest.fn().mockResolvedValue([
        entry({ scope_type: 'variant', scope_id: 'priced-variant', unit_price: 100 }),
      ]) },
    };
    const service = new PricingService(prisma as any);
    const lines = [
      { variant: variant({ id: 'priced-variant' }), qty: 1 },
      { variant: variant({ id: 'unpriced-variant' }), qty: 1 },
    ];

    await expect(service.calculateMany(ctx, lines)).rejects.toMatchObject({
      code: 'PRICING_NO_PRICE_AVAILABLE',
    });
  });
});

describe('PricingService — quoteMany (sync catalog snapshot: skips, never throws)', () => {
  it('omits unpriced variants from the result instead of failing the whole snapshot', () => {
    const service = new PricingService({} as any);
    const entries = [entry({ scope_type: 'variant', scope_id: 'priced-variant', unit_price: 100 })];
    const variants = [variant({ id: 'priced-variant' }), variant({ id: 'unpriced-variant' })];

    const quotes = service.quoteMany(variants, entries);

    expect(quotes.size).toBe(1);
    expect(quotes.has('priced-variant')).toBe(true);
    expect(quotes.has('unpriced-variant')).toBe(false);
  });
});
