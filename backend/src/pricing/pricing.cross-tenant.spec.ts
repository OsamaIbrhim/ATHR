import { randomUUID } from 'crypto';
import { PricingService } from './pricing.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `pricing` module. */

const VARIANT_A = randomUUID();
const VARIANT_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    productVariant: [
      {
        id: VARIANT_A,
        tenant_id: TENANT_A,
        product_id: randomUUID(),
        cost_price: 100,
        product: { category_id: null, brand: null },
      },
      {
        id: VARIANT_B,
        tenant_id: TENANT_B,
        product_id: randomUUID(),
        cost_price: 100,
        product: { category_id: null, brand: null },
      },
    ],
    pricingRule: [
      {
        id: randomUUID(),
        tenant_id: TENANT_A,
        name: 'A global',
        scope_type: 'global',
        scope_id: null,
        overhead_percent: 20,
        profit_percent: 35,
        tax_percent: 14,
        priority: 1,
        is_active: true,
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_B,
        name: 'B global',
        scope_type: 'global',
        scope_id: null,
        overhead_percent: 0,
        profit_percent: 0,
        tax_percent: 0,
        priority: 1,
        is_active: true,
      },
    ],
  });
  return { prisma, service: new PricingService(prisma) };
}

describe('pricing — cross-tenant isolation', () => {
  it('does not price another tenant\'s variant', async () => {
    const { service } = setup();
    await expect(service.calculate(contextFor(TENANT_B), VARIANT_A)).rejects.toThrow(
      'Variant not found',
    );
  });

  /**
   * The sharpest failure mode in this module: pricing rules are sorted by
   * priority, so an unscoped query could let another tenant's `global` rule
   * win and silently reprice this tenant's whole catalogue.
   */
  it('applies only the calling tenant\'s pricing rules', async () => {
    const { service } = setup();
    const quoteA = await service.calculate(contextFor(TENANT_A), VARIANT_A);
    const quoteB = await service.calculate(contextFor(TENANT_B), VARIANT_B);

    expect(quoteA.overhead_percent).toBe(20);
    expect(quoteA.selling_price).toBeGreaterThan(100);

    // Tenant B's own rule is all-zero, so its price is exactly cost.
    expect(quoteB.overhead_percent).toBe(0);
    expect(quoteB.selling_price).toBe(100);
  });

  it('loads only the calling tenant\'s active rules', async () => {
    const { service } = setup();
    const rulesA = await service.loadActiveRules(contextFor(TENANT_A));
    const rulesB = await service.loadActiveRules(contextFor(TENANT_B));
    expect(rulesA).toHaveLength(1);
    expect(rulesB).toHaveLength(1);
    expect(rulesA[0]).not.toEqual(rulesB[0]);
  });
});
