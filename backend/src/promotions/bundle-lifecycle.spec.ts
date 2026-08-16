import { randomUUID } from 'crypto';
import { BundleRepository } from './bundle.repository';
import { BundleService } from './bundle.service';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-008 Phase D — `Bundle` lifecycle (BR-BND-1xx): draft -> active -> ended,
 * plus `supersede` for a new version (BR-BND-101), the BR-BND-105 return-
 * policy activation gate, and `allocatePrice` (BR-BND-103).
 */

const ACTOR = randomUUID();
const VARIANT_1 = randomUUID();
const VARIANT_2 = randomUUID();

function setup(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const componentId = randomUUID();
  const prisma = fakePrisma({
    bundle: [
      {
        id,
        tenant_id: TENANT_A,
        name: 'Combo',
        status: 'draft',
        allocation_method: 'proportional_price',
        return_policy: null,
        version: 1,
        supersedes_id: null,
        created_at: new Date(),
        ...overrides,
      },
    ],
    bundleComponent:
      overrides.components === null
        ? []
        : [{ id: componentId, tenant_id: TENANT_A, bundle_id: id, variant_id: VARIANT_1, qty: 1, created_at: new Date() }],
  });
  const repo = new BundleRepository(prisma);
  return { id, service: new BundleService(repo), ctx: contextFor(TENANT_A) };
}

describe('Bundle lifecycle (BR-BND-1xx)', () => {
  it('creates a draft bundle with its components', async () => {
    const { service, ctx } = setup();
    const created = await service.create(ctx, ACTOR, {
      name: 'New combo',
      components: [
        { variant_id: VARIANT_1, qty: 1 },
        { variant_id: VARIANT_2, qty: 2 },
      ],
    } as any);
    expect(created.status).toBe('draft');
    expect(created.components).toHaveLength(2);
  });

  it('BR-BND-105/OD-CAT-012 analogue: activation is rejected without a declared return_policy', async () => {
    const { id, service, ctx } = setup();
    await expect(service.activate(ctx, ACTOR, id)).rejects.toMatchObject({
      code: 'BUNDLE_RETURN_POLICY_REQUIRED',
    });
  });

  it('activation is rejected for a bundle with zero components', async () => {
    const { id, service, ctx } = setup({ return_policy: 'whole_bundle_only', components: null });
    await expect(service.activate(ctx, ACTOR, id)).rejects.toMatchObject({ code: 'BUNDLE_EMPTY' });
  });

  it('activates once return_policy is declared and components exist', async () => {
    const { id, service, ctx } = setup({ return_policy: 'component_prorated' });
    const active = await service.activate(ctx, ACTOR, id);
    expect(active.status).toBe('active');
  });

  it('BR-BND-101: components are mutable only while draft', async () => {
    const { id, service, ctx } = setup({ status: 'active', return_policy: 'whole_bundle_only' });
    await expect(
      service.updateDraft(ctx, id, { components: [{ variant_id: VARIANT_2, qty: 1 }] } as any),
    ).rejects.toMatchObject({ code: 'BUNDLE_NOT_DRAFT' });
  });

  it('BR-BND-101: supersede creates a new draft version, leaving the active one untouched', async () => {
    const { id, service, ctx } = setup({ status: 'active', return_policy: 'whole_bundle_only' });
    const v2 = await service.supersede(ctx, ACTOR, id, {
      components: [{ variant_id: VARIANT_2, qty: 3 }],
      return_policy: 'component_prorated',
    } as any);
    expect(v2.status).toBe('draft');
    expect(v2.version).toBe(2);

    const v1 = await service.findOne(ctx, id);
    expect(v1.status).toBe('active');
    expect(v1.components.map((c) => c.variant_id)).toEqual([VARIANT_1]);
  });

  it('BR-BND-103: allocatePrice splits a bundle total proportionally and the parts sum exactly to the total', () => {
    const { service } = setup();
    const allocations = service.allocatePrice(100, [
      { variantId: 'a', qty: 1, standaloneUnitPrice: 30 },
      { variantId: 'b', qty: 1, standaloneUnitPrice: 70 },
    ]);
    expect(allocations.find((a) => a.variantId === 'a')?.allocatedAmount).toBeCloseTo(30, 2);
    expect(allocations.find((a) => a.variantId === 'b')?.allocatedAmount).toBeCloseTo(70, 2);
    const sum = allocations.reduce((total, a) => total + a.allocatedAmount, 0);
    expect(sum).toBeCloseTo(100, 8);
  });

  it('BR-BND-103: allocatePrice absorbs rounding remainder into the last component so parts always sum exactly', () => {
    const { service } = setup();
    // 10 split three ways by equal standalone price forces a rounding remainder.
    const allocations = service.allocatePrice(10, [
      { variantId: 'a', qty: 1, standaloneUnitPrice: 1 },
      { variantId: 'b', qty: 1, standaloneUnitPrice: 1 },
      { variantId: 'c', qty: 1, standaloneUnitPrice: 1 },
    ]);
    const sum = allocations.reduce((total, a) => total + a.allocatedAmount, 0);
    expect(sum).toBe(10);
  });
});
