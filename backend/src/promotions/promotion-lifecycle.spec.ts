import { randomUUID } from 'crypto';
import { PromotionRepository } from './promotion.repository';
import { PromotionService } from './promotion.service';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-008 Phase D — the full BR-PMT-1xx lifecycle:
 *   draft -[submit/approve: fields only, status unchanged]->
 *   draft -[schedule, requires both]-> scheduled -> active -> paused <-> active -> ended
 * plus draft/scheduled -> cancelled, self-approval forbidden (Permission
 * Matrix §19), and the OD-CAT-012 return_policy gate on activation.
 * Pause-doesn't-rewrite-history and activation-doesn't-reprice-completed-
 * sales (BR-PMT-103/104) hold trivially in this phase: no Sale integration
 * exists yet to touch (see `PromotionService`'s header comment) — there is
 * nothing for these transitions to retroactively affect.
 */

const ACTOR = randomUUID();
const OTHER_ACTOR = randomUUID();

function setup(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const prisma = fakePrisma({
    promotion: [
      {
        id,
        tenant_id: TENANT_A,
        name: 'Lifecycle promo',
        status: 'draft',
        timezone: 'Africa/Cairo',
        starts_at: new Date(),
        ends_at: null,
        priority: 100,
        stackability: 'exclusive',
        benefit_type: 'percentage',
        benefit_value: 10,
        scope_type: 'all',
        requires_coupon: false,
        return_policy: null,
        submitted_by: null,
        approved_by: null,
        created_at: new Date(),
        ...overrides,
      },
    ],
  });
  const repo = new PromotionRepository(prisma);
  return { id, service: new PromotionService(repo), ctx: contextFor(TENANT_A) };
}

describe('Promotion lifecycle (BR-PMT-1xx)', () => {
  it('moves draft -> scheduled -> active -> paused -> active -> ended, end to end', async () => {
    const { id, service, ctx } = setup({ return_policy: 'line_prorated' });

    await service.submit(ctx, ACTOR, id);
    let current = await service.approve(ctx, OTHER_ACTOR, id);
    expect(current.status).toBe('draft'); // BR-PMT-100: no visible "approved" state.
    expect(current.submitted_by).toBe(ACTOR);
    expect(current.approved_by).toBe(OTHER_ACTOR);

    current = await service.schedule(ctx, ACTOR, id);
    expect(current.status).toBe('scheduled');

    current = await service.activate(ctx, ACTOR, id);
    expect(current.status).toBe('active');

    current = await service.pause(ctx, ACTOR, id);
    expect(current.status).toBe('paused');

    current = await service.resume(ctx, ACTOR, id);
    expect(current.status).toBe('active');

    current = await service.end(ctx, ACTOR, id);
    expect(current.status).toBe('ended');
  });

  it('draft/scheduled -> cancelled', async () => {
    const { id, service, ctx } = setup();
    const cancelled = await service.cancel(ctx, ACTOR, id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('cannot cancel an active promotion (only draft/scheduled)', async () => {
    const { id, service, ctx } = setup({ status: 'active', return_policy: 'line_prorated' });
    await expect(service.cancel(ctx, ACTOR, id)).rejects.toMatchObject({
      code: 'PROMOTION_INVALID_TRANSITION',
    });
  });

  it('rejects scheduling before both submit and approve have happened', async () => {
    const { id, service, ctx } = setup();
    await expect(service.schedule(ctx, ACTOR, id)).rejects.toMatchObject({
      code: 'PROMOTION_INVALID_TRANSITION',
    });
    await service.submit(ctx, ACTOR, id);
    await expect(service.schedule(ctx, ACTOR, id)).rejects.toMatchObject({
      code: 'PROMOTION_INVALID_TRANSITION',
    });
  });

  it('Permission Matrix §19: the submitter cannot also approve (self-approval forbidden)', async () => {
    const { id, service, ctx } = setup();
    await service.submit(ctx, ACTOR, id);
    await expect(service.approve(ctx, ACTOR, id)).rejects.toMatchObject({
      code: 'PROMOTION_SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('OD-CAT-012: activation is rejected without a declared return_policy', async () => {
    const { id, service, ctx } = setup({ status: 'scheduled', submitted_by: ACTOR, approved_by: OTHER_ACTOR });
    await expect(service.activate(ctx, ACTOR, id)).rejects.toMatchObject({
      code: 'PROMOTION_RETURN_POLICY_REQUIRED',
    });
  });

  it('OD-CAT-012: activation succeeds once return_policy is declared', async () => {
    const { id, service, ctx } = setup({
      status: 'scheduled',
      submitted_by: ACTOR,
      approved_by: OTHER_ACTOR,
      return_policy: 'whole_promotion_only',
    });
    const active = await service.activate(ctx, ACTOR, id);
    expect(active.status).toBe('active');
  });

  it('BR-PMT-101: only a draft promotion may be edited', async () => {
    const { id, service, ctx } = setup({ status: 'active', return_policy: 'line_prorated' });
    await expect(service.updateDraft(ctx, id, { name: 'Renamed' })).rejects.toMatchObject({
      code: 'PROMOTION_INVALID_TRANSITION',
    });
  });

  it('BR-BEN-100: a "bogo" promotion requires bogo_* fields, not benefit_value', async () => {
    const { service, ctx } = setup();
    await expect(
      service.create(ctx, ACTOR, {
        name: 'Bad bogo',
        starts_at: new Date().toISOString(),
        benefit_type: 'bogo',
      } as any),
    ).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
  });
});
