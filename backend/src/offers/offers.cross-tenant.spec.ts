import { randomUUID } from 'crypto';
import { OffersService } from './offers.service';
import { PricingService } from '../pricing/pricing.service';
import { CostVisibilityService } from '../pricing/cost-visibility.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';
import { TaxResolutionService } from '../tax/tax-resolution.service';

/** WP-007 Phase A §A.3.6 — cross-tenant isolation for the `offers` module. */

const SUGGESTION_A = randomUUID();
const SUGGESTION_B = randomUUID();
const BRANCH_A = randomUUID();
const BRANCH_B = randomUUID();

function setup() {
  const prisma = fakePrisma({
    inventoryStock: [],
    offerSuggestion: [
      {
        id: SUGGESTION_A,
        tenant_id: TENANT_A,
        branch_id: BRANCH_A,
        variant_id: randomUUID(),
        status: 'pending',
        days_unsold: 100,
        current_price: 100,
        suggested_price: 90,
        min_allowed_price: 80,
      },
      {
        id: SUGGESTION_B,
        tenant_id: TENANT_B,
        branch_id: BRANCH_B,
        variant_id: randomUUID(),
        status: 'pending',
        days_unsold: 100,
        current_price: 100,
        suggested_price: 90,
        min_allowed_price: 80,
      },
    ],
    auditLog: [],
    productVariant: [],
    pricingRule: [],
  });
  // Cost visibility is granted here so these stay isolation tests -- the
  // masking behaviour itself is pinned in `offers.cost-visibility.spec.ts`.
  const costVisibility = new CostVisibilityService({
    hasPermission: async () => true,
  } as unknown as PermissionPolicyService);
  return { prisma, service: new OffersService(prisma, new PricingService(prisma, new TaxResolutionService(prisma)), costVisibility) };
}

const actorFor = (branchId: string) =>
  ({ sub: randomUUID(), role: 'owner', membership_role: 'tenant_owner', branch_id: branchId, capabilities: [] }) as any;

describe('offers — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s pending suggestions', async () => {
    const { service } = setup();
    const forA = await service.suggestions(contextFor(TENANT_A), actorFor(BRANCH_A));
    expect(forA.map((row: any) => row.id)).toEqual([SUGGESTION_A]);

    const forB = await service.suggestions(contextFor(TENANT_B), actorFor(BRANCH_B));
    expect(forB.map((row: any) => row.id)).toEqual([SUGGESTION_B]);
  });

  it('does not review another tenant\'s suggestion', async () => {
    const { service, prisma } = setup();
    await expect(
      service.review(contextFor(TENANT_B), SUGGESTION_A, 'approved', actorFor(BRANCH_A)),
    ).rejects.toThrow('Offer suggestion not found');

    expect(prisma.offerSuggestion.rows.find((row: any) => row.id === SUGGESTION_A).status).toBe(
      'pending',
    );
    expect(prisma.auditLog.rows).toHaveLength(0);
  });

  it('reviews the caller\'s own suggestion and stamps the audit row with its tenant', async () => {
    const { service, prisma } = setup();
    await service.review(contextFor(TENANT_A), SUGGESTION_A, 'approved', actorFor(BRANCH_A));

    expect(prisma.offerSuggestion.rows.find((row: any) => row.id === SUGGESTION_A).status).toBe(
      'approved',
    );
    expect(prisma.auditLog.rows).toHaveLength(1);
    expect(prisma.auditLog.rows[0].tenant_id).toBe(TENANT_A);
  });
});
