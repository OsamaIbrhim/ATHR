import { randomUUID } from 'crypto';
import { OverridesRepository } from './overrides.repository';
import { OverridesService } from './overrides.service';
import { PricingService } from './pricing.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase B (BR-OVP-1xx, BR-DSC-2xx): override vs. discount separation, floor approval. */

const ctx = contextFor(TENANT_A);
const VARIANT_ID = randomUUID();

function actor(overrides: Record<string, unknown> = {}) {
  return {
    sub: randomUUID(),
    role: 'cashier',
    branch_id: null,
    membership_role: 'cashier',
    ...overrides,
  } as any;
}

function setup(options: { policy?: Record<string, unknown> | null; hasAboveThreshold?: boolean } = {}) {
  const prisma = fakePrisma({
    productVariant: [
      { id: VARIANT_ID, tenant_id: TENANT_A, product_id: randomUUID(), cost_price: 50, product: { category_id: null, brand_id: null } },
    ],
    priceBook: [{ id: 'book-1', tenant_id: TENANT_A, status: 'active' }],
    priceBookEntry: [
      {
        id: 'entry-1', tenant_id: TENANT_A, price_book_id: 'book-1', scope_type: 'global',
        scope_id: null, min_qty: 1, unit_price: 100, allow_zero_price: false, tax_percent: 0,
        floor_price: 80, effective_from: new Date(0), effective_to: null, status: 'active',
      },
    ],
    priceOverridePolicy: options.policy === null ? [] : [
      { id: randomUUID(), tenant_id: TENANT_A, role: 'cashier', ...options.policy },
    ],
    priceOverride: [],
    discount: [],
  }, {
    priceBookEntry: { price_book: { table: 'priceBook', localKey: 'price_book_id' } },
  });
  const pricing = new PricingService(prisma);
  const overridesRepo = new OverridesRepository(prisma);
  const permissionPolicy = {
    hasPermission: jest.fn().mockResolvedValue(options.hasAboveThreshold ?? false),
  } as unknown as PermissionPolicyService;
  return { prisma, service: new OverridesService(overridesRepo, pricing, permissionPolicy), permissionPolicy };
}

describe('OverridesService — manual override vs. discount are distinct entities (BR-OVP-100)', () => {
  it('records an override as a PriceOverride row distinct from a Discount row', async () => {
    const { service, prisma } = setup({ policy: {} });
    await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'loyalty match',
    } as any);

    expect(prisma.priceOverride.rows).toHaveLength(1);
    expect(prisma.discount.rows).toHaveLength(0);
    const row = prisma.priceOverride.rows[0];
    expect(row.base_price.toString()).toBe('100');
    expect(row.override_price.toString()).toBe('90');
    expect(row.is_below_floor).toBe(false);
    expect(row.reason).toBe('loyalty match');
  });

  it('records a discount as a Discount row distinct from a PriceOverride row', async () => {
    const { service, prisma } = setup({ policy: {} });
    await service.applyDiscount(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, basis: 'percentage', amount: 10,
    } as any);

    expect(prisma.discount.rows).toHaveLength(1);
    expect(prisma.priceOverride.rows).toHaveLength(0);
    const row = prisma.discount.rows[0];
    expect(row.base_price.toString()).toBe('100');
    expect(row.final_price.toString()).toBe('90');
    expect(row.basis).toBe('percentage');
    expect(row.amount).toBe(10);
  });
});

describe('OverridesService — role-based override limits (BR-OVP-101)', () => {
  it('rejects a discount percentage beyond the role\'s configured limit', async () => {
    const { service } = setup({ policy: { max_discount_percent: 5 } });
    await expect(
      service.applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_LIMIT_EXCEEDED' });
  });

  it('rejects a discount amount beyond the role\'s configured limit', async () => {
    const { service } = setup({ policy: { max_discount_amount: 5 } });
    await expect(
      service.applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_LIMIT_EXCEEDED' });
  });

  it('rejects a price increase when the role\'s policy disallows it', async () => {
    const { service } = setup({ policy: { allow_price_increase: false } });
    await expect(
      service.applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 110, reason: 'x' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_LIMIT_EXCEEDED' });
  });

  it('allows an override within the configured limit', async () => {
    const { service } = setup({ policy: { max_discount_percent: 20 } });
    const result = await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 90, reason: 'x',
    } as any);
    expect(result.override_price.toString()).toBe('90');
  });

  it('allows any discount depth when the role has no configured policy row (still subject to the floor check)', async () => {
    const { service } = setup({ policy: null, hasAboveThreshold: true });
    // Below the entry's floor_price (80) -- allowed here only because this
    // actor also holds pricing.manual-override.above-threshold; a missing
    // policy row means "no configured limit", not "no floor check".
    const result = await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 5, reason: 'x',
    } as any);
    expect(result.override_price.toString()).toBe('5');
  });
});

describe('OverridesService — below-floor requires a separate approval permission (BR-OVP-102)', () => {
  it('rejects a below-floor override when the actor lacks pricing.manual-override.above-threshold', async () => {
    const { service } = setup({ policy: {}, hasAboveThreshold: false });
    // floor_price = 80 on the entry; 70 is below it.
    await expect(
      service.applyOverride(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, override_price: 70, reason: 'clearance' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_OVERRIDE_BELOW_FLOOR_REQUIRES_APPROVAL' });
  });

  it('records the below-floor override with an approval stamp when the actor holds the threshold permission', async () => {
    const { service, permissionPolicy } = setup({ policy: {}, hasAboveThreshold: true });
    const applier = actor();
    const result = await service.applyOverride(ctx, applier, {
      variant_id: VARIANT_ID, qty: 1, override_price: 70, reason: 'clearance',
    } as any);

    expect(permissionPolicy.hasPermission).toHaveBeenCalledWith('cashier', 'pricing.manual-override.above-threshold');
    expect(result.is_below_floor).toBe(true);
    expect(result.approved_by).toBe(applier.sub);
    expect(result.approved_at).not.toBeNull();
  });

  it('never checks the above-threshold permission for an at-or-above-floor override (one permission does not imply the other)', async () => {
    const { service, permissionPolicy } = setup({ policy: {}, hasAboveThreshold: false });
    await service.applyOverride(ctx, actor(), {
      variant_id: VARIANT_ID, qty: 1, override_price: 85, reason: 'x',
    } as any);
    expect(permissionPolicy.hasPermission).not.toHaveBeenCalled();
  });
});

describe('OverridesService — discounts never go negative (BR-DSC-202)', () => {
  it('rejects a fixed-amount discount larger than the base price', async () => {
    const { service } = setup({ policy: {} });
    await expect(
      service.applyDiscount(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, basis: 'fixed_amount', amount: 500 } as any),
    ).rejects.toMatchObject({ code: 'PRICING_DISCOUNT_EXCEEDS_BASE_PRICE' });
  });

  it('rejects a percentage discount above 100', async () => {
    const { service } = setup({ policy: {} });
    await expect(
      service.applyDiscount(ctx, actor(), { variant_id: VARIANT_ID, qty: 1, basis: 'percentage', amount: 150 } as any),
    ).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
  });
});
