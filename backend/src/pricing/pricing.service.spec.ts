import { Prisma } from '@prisma/client';
import { PricingService, ResolvedPriceEntry } from './pricing.service';
import { TaxResolutionService, type TaxCodeIndex } from '../tax/tax-resolution.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';
import { aTaxCode, taxCategoryIdFor } from '../identity/testing/fixture-builders';

// WP-008 Phase B: PricingService resolves against active PriceBookEntry rows
// instead of the flat PricingRule formula. `qty=1`/no `qty` maps to the base
// (non-quantity-break) entry unless a test says otherwise.
const ctx = contextFor(TENANT_A);

const VARIANT_ID = 'variant-1';
const PRODUCT_ID = 'product-1';
const BRAND_ID = 'brand-1';
const CATEGORY_ID = 'category-1';

// WP-008 Phase C: the rate no longer comes from the entry — it is resolved
// from the active TaxCode for the variant's tax category (BR-TAX-201). Every
// `quote()` call therefore needs an index; `TAX_CODES` is the standard 14%
// exclusive one so the Phase B assertions below keep their original numbers.
const TAX_CATEGORY_ID = taxCategoryIdFor(TENANT_A);

function taxIndex(overrides: Record<string, unknown> = {}): TaxCodeIndex {
  return new Map([
    [TAX_CATEGORY_ID, aTaxCode({ tax_category_id: TAX_CATEGORY_ID, ...overrides }) as any],
  ]);
}

const TAX_CODES = taxIndex();

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: VARIANT_ID,
    product_id: PRODUCT_ID,
    cost_price: 85,
    tax_category_id: null,
    product: {
      brand_id: BRAND_ID,
      category_id: CATEGORY_ID,
      tax_category_id: TAX_CATEGORY_ID,
    },
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
    // BR-TAX-204: every entry states its mode. The default matches the
    // migrated corpus (the pre-Phase-C engine added tax on top of the stored
    // price), so the Phase B expectations below are unchanged.
    tax_mode: 'exclusive',
    floor_price: null,
    ...overrides,
  };
}

describe('PricingService — deterministic price-source ordering (BR-PSL-100)', () => {
  const service = new PricingService({} as any, new TaxResolutionService({} as any));

  it('prefers a variant-scoped entry over every other level', () => {
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
      entry({ scope_type: 'brand', scope_id: BRAND_ID, unit_price: 30 }),
      entry({ scope_type: 'product', scope_id: PRODUCT_ID, unit_price: 40 }),
      entry({ scope_type: 'variant', scope_id: VARIANT_ID, unit_price: 50 }),
    ];
    expect(service.quote(variant(), entries, 1, TAX_CODES)!.net_price).toBe(50);
  });

  it('falls back to product scope when no variant entry exists', () => {
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
      entry({ scope_type: 'brand', scope_id: BRAND_ID, unit_price: 30 }),
      entry({ scope_type: 'product', scope_id: PRODUCT_ID, unit_price: 40 }),
    ];
    expect(service.quote(variant(), entries, 1, TAX_CODES)!.net_price).toBe(40);
  });

  it('falls back to brand scope when no variant/product entry exists', () => {
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
      entry({ scope_type: 'brand', scope_id: BRAND_ID, unit_price: 30 }),
    ];
    expect(service.quote(variant(), entries, 1, TAX_CODES)!.net_price).toBe(30);
  });

  it('falls back to category scope when no variant/product/brand entry exists', () => {
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
    ];
    expect(service.quote(variant(), entries, 1, TAX_CODES)!.net_price).toBe(20);
  });

  it('falls back to the global entry when nothing more specific exists', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 10 })];
    expect(service.quote(variant(), entries, 1, TAX_CODES)!.net_price).toBe(10);
  });

  it('ignores entries scoped to a different variant/product/brand/category', () => {
    const entries = [
      entry({ scope_type: 'variant', scope_id: 'some-other-variant', unit_price: 999 }),
      entry({ scope_type: 'product', scope_id: 'some-other-product', unit_price: 999 }),
      entry({ scope_type: 'brand', scope_id: 'some-other-brand', unit_price: 999 }),
      entry({ scope_type: 'category', scope_id: 'some-other-category', unit_price: 999 }),
      entry({ scope_type: 'global', unit_price: 42 }),
    ];
    expect(service.quote(variant(), entries, 1, TAX_CODES)!.net_price).toBe(42);
  });

  it('BR-PSL-101: returns null (no silent fallback) when no entry resolves at any level', () => {
    expect(service.quote(variant(), [], 1, TAX_CODES)).toBeNull();
  });

  it('BR-PSL-101/CERR-200: calculate() blocks pricing with PRICING_NO_PRICE_AVAILABLE instead of a zero/default price', async () => {
    const prisma = {
      productVariant: { findFirst: jest.fn().mockResolvedValue(variant()) },
      priceBookEntry: { findMany: jest.fn().mockResolvedValue([]) },
      taxCode: { findMany: jest.fn().mockResolvedValue([...TAX_CODES.values()]) },
    };
    await expect(new PricingService(prisma as any, new TaxResolutionService(prisma as any)).calculate(ctx, VARIANT_ID)).rejects.toMatchObject({
      code: 'PRICING_NO_PRICE_AVAILABLE',
    });
  });

  it('computes tax_amount/selling_price/min_allowed_price from the winning entry', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 100, tax_percent: 14 })];
    const quote = service.quote(variant(), entries, 1, TAX_CODES)!;
    expect(quote.net_price).toBe(100);
    expect(quote.tax_amount).toBe(14);
    expect(quote.selling_price).toBe(114);
    // No explicit floor_price on the entry -> cost-based fallback (BR-OVP-102).
    expect(quote.min_allowed_price).toBe(85);
  });

  it('uses the entry\'s explicit floor_price over the cost-based fallback', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 100, floor_price: 60 })];
    expect(service.quote(variant(), entries, 1, TAX_CODES)!.min_allowed_price).toBe(60);
  });
});

describe('PricingService — quantity breaks (BR-PSL-104)', () => {
  const service = new PricingService({} as any, new TaxResolutionService({} as any));
  const entries = [
    entry({ scope_type: 'variant', scope_id: VARIANT_ID, min_qty: 1, unit_price: 100 }),
    entry({ scope_type: 'variant', scope_id: VARIANT_ID, min_qty: 10, unit_price: 90 }),
    entry({ scope_type: 'variant', scope_id: VARIANT_ID, min_qty: 50, unit_price: 80 }),
  ];

  it('uses the base entry below the first break', () => {
    expect(service.quote(variant(), entries, 1, TAX_CODES)!.net_price).toBe(100);
    expect(service.quote(variant(), entries, 9, TAX_CODES)!.net_price).toBe(100);
  });

  it('uses the tightest qualifying break at and above its threshold', () => {
    expect(service.quote(variant(), entries, 10, TAX_CODES)!.net_price).toBe(90);
    expect(service.quote(variant(), entries, 49, TAX_CODES)!.net_price).toBe(90);
    expect(service.quote(variant(), entries, 50, TAX_CODES)!.net_price).toBe(80);
    expect(service.quote(variant(), entries, 1000, TAX_CODES)!.net_price).toBe(80);
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
    expect(service.quote(variant(), withGlobalFallback, 1, TAX_CODES)!.net_price).toBe(10);
    expect(service.quote(variant(), withGlobalFallback, 10, TAX_CODES)!.net_price).toBe(90);
  });
});

describe('PricingService — calculateMany (BR-PSL-101 blocks the whole batch on any unpriced line)', () => {
  it('prices every line after one entry query', async () => {
    const prisma = {
      priceBookEntry: { findMany: jest.fn().mockResolvedValue([entry({ scope_type: 'global', unit_price: 100 })]) },
      taxCode: { findMany: jest.fn().mockResolvedValue([...TAX_CODES.values()]) },
    };
    const service = new PricingService(prisma as any, new TaxResolutionService(prisma as any));
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
      taxCode: { findMany: jest.fn().mockResolvedValue([...TAX_CODES.values()]) },
    };
    const service = new PricingService(prisma as any, new TaxResolutionService(prisma as any));
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
    const service = new PricingService({} as any, new TaxResolutionService({} as any));
    const entries = [entry({ scope_type: 'variant', scope_id: 'priced-variant', unit_price: 100 })];
    const variants = [variant({ id: 'priced-variant' }), variant({ id: 'unpriced-variant' })];

    const quotes = service.quoteMany(variants, entries, TAX_CODES);

    expect(quotes.size).toBe(1);
    expect(quotes.has('priced-variant')).toBe(true);
    expect(quotes.has('unpriced-variant')).toBe(false);
  });
});

/**
 * B4 — the POS snapshot path resolves the whole catalog in one call. Scanning
 * every tenant entry per variant per scope level made that O(N²)
 * (~10⁸ filter operations at 10k variants). Entries are bucketed by
 * `scope_type:scope_id` once per call instead.
 */
describe('PricingService — resolution is indexed, not a full scan (B4)', () => {
  it('loads only the ACTIVE DEFAULT book\'s entries — a non-default active book never contributes', async () => {
    const prisma = { priceBookEntry: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new PricingService(prisma as any, new TaxResolutionService(prisma as any));

    await service.loadActiveRules(ctx);

    const where = prisma.priceBookEntry.findMany.mock.calls[0][0].where;
    expect(where.price_book).toMatchObject({
      tenant_id: TENANT_A,
      status: 'active',
      is_default: true,
    });
  });

  it('buckets entries by scope so each variant only touches its own candidates', () => {
    const service = new PricingService({} as any, new TaxResolutionService({} as any));
    const index = service.buildIndex([
      entry({ scope_type: 'variant', scope_id: 'v-1', unit_price: 11 }),
      entry({ scope_type: 'variant', scope_id: 'v-2', unit_price: 22 }),
      entry({ scope_type: 'global', unit_price: 99 }),
    ]);

    expect(index.get('variant:v-1')).toHaveLength(1);
    expect(index.get('variant:v-2')).toHaveLength(1);
    expect(index.get('global:')).toHaveLength(1);
    expect(index.get('variant:v-3')).toBeUndefined();
  });

  it('resolves identically whether given a raw entry array or a prebuilt index', () => {
    const service = new PricingService({} as any, new TaxResolutionService({} as any));
    const entries = [
      entry({ scope_type: 'global', unit_price: 10 }),
      entry({ scope_type: 'category', scope_id: CATEGORY_ID, unit_price: 20 }),
      entry({ scope_type: 'variant', scope_id: VARIANT_ID, unit_price: 50 }),
      entry({ scope_type: 'variant', scope_id: VARIANT_ID, min_qty: 10, unit_price: 45 }),
    ];

    const fromArray = service.quote(variant(), entries, 12, TAX_CODES);
    const fromIndex = service.quote(variant(), service.buildIndex(entries), 12, TAX_CODES);

    expect(fromArray).toEqual(fromIndex);
    // Highest qualifying min_qty inside the winning bucket still wins.
    expect(fromIndex!.net_price).toBe(45);
  });

  it('prices a 2,000-variant catalog against a 2,000-entry book without a per-variant full scan', () => {
    const service = new PricingService({} as any, new TaxResolutionService({} as any));
    const size = 2_000;
    const entries = Array.from({ length: size }, (_, index) =>
      entry({ scope_type: 'variant', scope_id: `v-${index}`, unit_price: 100 + index }),
    );
    const variants = Array.from({ length: size }, (_, index) =>
      variant({ id: `v-${index}`, product_id: `p-${index}` }),
    );

    const quotes = service.quoteMany(variants, entries, TAX_CODES);

    expect(quotes.size).toBe(size);
    expect(quotes.get('v-0')!.net_price).toBe(100);
    expect(quotes.get(`v-${size - 1}`)!.net_price).toBe(100 + size - 1);
  });
});

/**
 * B3 — BR-CST-101: the floor is the variant's cost whenever the resolved entry
 * has no explicit `floor_price`. `floor_is_cost_derived` records which of the
 * two it was, so the masking at the HTTP boundary is auditable.
 */
describe('PricingService — the cost-derived floor is flagged as such', () => {
  const service = new PricingService({} as any, new TaxResolutionService({} as any));

  it('flags a floor that fell back to the variant cost', () => {
    const quote = service.quote(variant({ cost_price: 85 }), [entry({ scope_type: 'global', unit_price: 100 })], 1, TAX_CODES);
    expect(quote!.min_allowed_price).toBe(85);
    expect(quote!.floor_is_cost_derived).toBe(true);
  });

  it('does not flag an explicit entry floor', () => {
    const quote = service.quote(variant({ cost_price: 85 }), [
      entry({ scope_type: 'global', unit_price: 100, floor_price: 90 }),
    ], 1, TAX_CODES);
    expect(quote!.min_allowed_price).toBe(90);
    expect(quote!.floor_is_cost_derived).toBe(false);
  });
});

describe('PricingService — inclusive vs. exclusive per price context (BR-TAX-204)', () => {
  const service = new PricingService({} as any, new TaxResolutionService({} as any));

  it('EXCLUSIVE entry: the authored price is the net, tax is added on top', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 100, tax_mode: 'exclusive' })];
    const quote = service.quote(variant(), entries, 1, TAX_CODES)!;

    expect(quote.net_price).toBe(100);
    expect(quote.tax_amount).toBe(14);
    expect(quote.selling_price).toBe(114);
  });

  it('INCLUSIVE entry: the authored price is the gross, the net is extracted from it', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 114, tax_mode: 'inclusive' })];
    const quote = service.quote(variant(), entries, 1, TAX_CODES)!;

    // The shelf price is honoured exactly — this is the whole point of an
    // inclusive context, and what POS displays.
    expect(quote.selling_price).toBe(114);
    expect(quote.net_price).toBe(100);
    expect(quote.tax_amount).toBe(14);
  });

  it('the same authored number prices differently under each mode', () => {
    const exclusive = service.quote(
      variant(), [entry({ scope_type: 'global', unit_price: 100, tax_mode: 'exclusive' })], 1, TAX_CODES,
    )!;
    const inclusive = service.quote(
      variant(), [entry({ scope_type: 'global', unit_price: 100, tax_mode: 'inclusive' })], 1, TAX_CODES,
    )!;

    expect(exclusive.selling_price).toBe(114);
    expect(inclusive.selling_price).toBe(100);
  });

  it('the rate comes from the TaxCode, NOT from the entry\'s legacy tax_percent', () => {
    // The entry still carries a stale 14 from before Phase C; the active code
    // says 20. Two sources of truth for a charged amount is exactly what this
    // phase removes — the code must win.
    const entries = [entry({ scope_type: 'global', unit_price: 100, tax_percent: 14 })];
    const quote = service.quote(variant(), entries, 1, taxIndex({ rate: new Prisma.Decimal(20) }))!;

    expect(quote.tax_percent).toBe(20);
    expect(quote.tax_amount).toBe(20);
    expect(quote.selling_price).toBe(120);
  });

  it('a variant-level tax category override wins over the product default (OD-CAT-014)', () => {
    const OVERRIDE_CATEGORY = 'override-category';
    const codes = new Map([
      [TAX_CATEGORY_ID, aTaxCode({ rate: new Prisma.Decimal(14) }) as any],
      [OVERRIDE_CATEGORY, aTaxCode({ tax_category_id: OVERRIDE_CATEGORY, rate: new Prisma.Decimal(5) }) as any],
    ]);
    const entries = [entry({ scope_type: 'global', unit_price: 100 })];

    const inherited = service.quote(variant(), entries, 1, codes)!;
    const overridden = service.quote(
      variant({ tax_category_id: OVERRIDE_CATEGORY }), entries, 1, codes,
    )!;

    expect(inherited.tax_amount).toBe(14);
    expect(overridden.tax_amount).toBe(5);
  });

  it('BR-TAX-201: a category with no active code BLOCKS pricing rather than quoting untaxed', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 100 })];
    expect(() => service.quote(variant(), entries, 1, new Map())).toThrow(
      /No active tax code for category/,
    );
  });

  it('quoteMany OMITS an item with no active tax code instead of advertising it untaxed', () => {
    // The POS catalog must not fail wholesale for one misconfigured item, and
    // must never tell a till a rate it cannot verify (BR-PSL-101 precedent).
    const entries = [entry({ scope_type: 'global', unit_price: 100 })];
    const priced = variant();
    const unpriceable = variant({
      id: 'variant-2',
      product: { brand_id: null, category_id: null, tax_category_id: 'missing-category' },
    });

    const result = service.quoteMany([priced, unpriceable], entries, TAX_CODES);
    expect(result.has(priced.id)).toBe(true);
    expect(result.has('variant-2')).toBe(false);
  });

  it('carries the BR-TAX-202 snapshot on the quote so the sale stamps the version it was priced at', () => {
    const entries = [entry({ scope_type: 'global', unit_price: 100 })];
    const quote = service.quote(variant(), entries, 1, TAX_CODES)!;

    expect(quote.tax).toMatchObject({
      code_snapshot: 'STANDARD',
      mode_snapshot: 'exclusive',
      version_snapshot: 1,
      exemption_id: null,
    });
    expect(quote.tax.base_amount.toNumber()).toBe(100);
    expect(quote.tax.tax_amount.toNumber()).toBe(14);
  });
});
