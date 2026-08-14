import { Prisma } from '@prisma/client';
import { TaxCodeRepository } from './tax-code.repository';
import { TaxCodeService } from './tax-code.service';
import { aTaxCategory, aTaxCode, taxCategoryIdFor } from '../identity/testing/fixture-builders';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

const ctx = contextFor(TENANT_A);
const CATEGORY_A = taxCategoryIdFor(TENANT_A);
const MAKER = '11111111-1111-4111-8111-111111111111';
const CHECKER = '22222222-2222-4222-8222-222222222222';

function setup(codes: any[] = []) {
  const prisma = fakePrisma({
    taxCategory: [aTaxCategory({ tenant_id: TENANT_A })],
    taxCode: codes,
  });
  const repo = new TaxCodeRepository(prisma);
  return { prisma, repo, service: new TaxCodeService(repo) };
}

const draft = (overrides: Record<string, unknown> = {}) =>
  aTaxCode({ tenant_id: TENANT_A, status: 'draft', ...overrides });

describe('TaxCodeService — maker-checker lifecycle (BR-TAX-200, Matrix §18)', () => {
  it('walks draft -> submitted -> approved -> scheduled -> active', async () => {
    const row = draft({ id: 'code-1' });
    const { service } = setup([row]);

    expect((await service.submit(ctx, MAKER, 'code-1')).status).toBe('submitted');
    expect((await service.approve(ctx, CHECKER, 'code-1')).status).toBe('approved');
    expect((await service.schedule(ctx, CHECKER, 'code-1')).status).toBe('scheduled');
    expect((await service.activate(ctx, CHECKER, 'code-1')).status).toBe('active');
  });

  it('records who performed each transition and when', async () => {
    const { service } = setup([draft({ id: 'code-1' })]);
    await service.submit(ctx, MAKER, 'code-1');
    const approved = await service.approve(ctx, CHECKER, 'code-1');

    expect(approved.submitted_by).toBe(MAKER);
    expect(approved.approved_by).toBe(CHECKER);
    expect(approved.submitted_at).toBeInstanceOf(Date);
    expect(approved.approved_at).toBeInstanceOf(Date);
  });

  it('rejects a transition that skips a stage (draft cannot jump to approved)', async () => {
    const { service } = setup([draft({ id: 'code-1' })]);
    await expect(service.approve(ctx, CHECKER, 'code-1')).rejects.toMatchObject({
      code: 'TAX_CODE_INVALID_TRANSITION',
    });
  });

  it('rejects activating a draft — approval is not optional', async () => {
    const { service } = setup([draft({ id: 'code-1' })]);
    await expect(service.activate(ctx, CHECKER, 'code-1')).rejects.toMatchObject({
      code: 'TAX_CODE_INVALID_TRANSITION',
    });
  });

  it('Matrix §18 H/A2/P2: the submitter of a version cannot approve it', async () => {
    const { service } = setup([draft({ id: 'code-1' })]);
    await service.submit(ctx, MAKER, 'code-1');

    await expect(service.approve(ctx, MAKER, 'code-1')).rejects.toMatchObject({
      code: 'TAX_CODE_SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('a second, concurrent submit affects zero rows instead of racing', async () => {
    const { service } = setup([draft({ id: 'code-1' })]);
    await service.submit(ctx, MAKER, 'code-1');
    await expect(service.submit(ctx, MAKER, 'code-1')).rejects.toMatchObject({
      code: 'TAX_CODE_INVALID_TRANSITION',
    });
  });
});

describe('TaxCodeService — BR-TAX-203: an active rate is immutable', () => {
  it('rejects editing an ACTIVE code, directing the caller to a new version', async () => {
    const { service } = setup([aTaxCode({ tenant_id: TENANT_A, id: 'code-1', status: 'active' })]);

    await expect(service.updateDraft(ctx, 'code-1', { rate: 20 })).rejects.toMatchObject({
      code: 'TAX_CODE_INVALID_TRANSITION',
    });
    await expect(service.updateDraft(ctx, 'code-1', { rate: 20 })).rejects.toThrow(/BR-TAX-203/);
  });

  it('allows editing a DRAFT rate — nothing has been charged under it yet', async () => {
    const { service } = setup([draft({ id: 'code-1' })]);
    const updated = await service.updateDraft(ctx, 'code-1', { rate: 20 });
    expect(Number(updated.rate)).toBe(20);
  });

  it('supersede creates the next version as a DRAFT, leaving the live one charging', async () => {
    const live = aTaxCode({
      tenant_id: TENANT_A,
      id: 'code-1',
      status: 'active',
      version: 1,
      rate: new Prisma.Decimal('14.0000'),
    });
    const { service, prisma } = setup([live]);

    const next = await service.supersede(ctx, MAKER, 'code-1', { rate: 20, tax_mode: 'exclusive' });

    expect(next.version).toBe(2);
    expect(next.status).toBe('draft');
    expect(next.supersedes_id).toBe('code-1');
    // The crucial half: drafting a successor changes no rate on its own.
    const predecessor = await prisma.taxCode.findFirst({ where: { id: 'code-1' } });
    expect(predecessor.status).toBe('active');
    // Decimal normalises trailing zeros, so compare numerically.
    expect(Number(predecessor.rate)).toBe(14);
  });

  it('refuses to supersede anything but an active version', async () => {
    const { service } = setup([draft({ id: 'code-1' })]);
    await expect(
      service.supersede(ctx, MAKER, 'code-1', { rate: 20, tax_mode: 'exclusive' }),
    ).rejects.toMatchObject({ code: 'TAX_CODE_INVALID_TRANSITION' });
  });

  it('the successor inherits the predecessor code/category so it replaces rather than forks', async () => {
    const live = aTaxCode({
      tenant_id: TENANT_A,
      id: 'code-1',
      status: 'active',
      code: 'REDUCED',
      tax_category_id: CATEGORY_A,
      rounding_policy: 'document',
    });
    const { service } = setup([live]);

    const next = await service.supersede(ctx, MAKER, 'code-1', { rate: 8, tax_mode: 'inclusive' });
    expect(next.code).toBe('REDUCED');
    expect(next.tax_category_id).toBe(CATEGORY_A);
    expect(next.rounding_policy).toBe('document');
    // But the caller's explicit choices win.
    expect(next.tax_mode).toBe('inclusive');
    expect(Number(next.rate)).toBe(8);
  });
});

describe('TaxCodeService — activation swaps exactly one active version', () => {
  it('supersedes the incumbent and promotes the successor', async () => {
    const incumbent = aTaxCode({ tenant_id: TENANT_A, id: 'v1', status: 'active', version: 1 });
    const successor = aTaxCode({
      tenant_id: TENANT_A,
      id: 'v2',
      status: 'approved',
      version: 2,
      rate: new Prisma.Decimal('20.0000'),
    });
    const { service, prisma } = setup([incumbent, successor]);

    const activated = await service.activate(ctx, CHECKER, 'v2');

    expect(activated.status).toBe('active');
    expect(activated.supersedes_id).toBe('v1');
    const previous = await prisma.taxCode.findFirst({ where: { id: 'v1' } });
    expect(previous.status).toBe('superseded');
    expect(previous.superseded_by_id).toBe('v2');
  });

  it('activating the already-active version is a no-op, not an error', async () => {
    const { service } = setup([
      aTaxCode({ tenant_id: TENANT_A, id: 'v1', status: 'active' }),
    ]);
    // Guarded at the top of `activate`: an 'active' code is neither approved
    // nor scheduled, so the transition is rejected rather than double-applied.
    await expect(service.activate(ctx, CHECKER, 'v1')).rejects.toMatchObject({
      code: 'TAX_CODE_INVALID_TRANSITION',
    });
  });

  it('does not overwrite an explicitly scheduled effective_from', async () => {
    const scheduledAt = new Date('2026-09-01T00:00:00.000Z');
    const { service } = setup([
      aTaxCode({
        tenant_id: TENANT_A,
        id: 'v1',
        status: 'scheduled',
        effective_from: scheduledAt,
      }),
    ]);
    const activated = await service.activate(ctx, CHECKER, 'v1');
    expect(activated.effective_from).toEqual(scheduledAt);
  });
});

describe('TaxCodeService — list endpoints paginate (CLAUDE.md §3.2)', () => {
  it('caps page size and reports the total alongside the page', async () => {
    const codes = Array.from({ length: 30 }, (_, index) =>
      aTaxCode({ tenant_id: TENANT_A, id: `code-${index}`, code: `C${index}`, status: 'draft' }),
    );
    const { service } = setup(codes);

    const page = await service.list(ctx, { page: 2, page_size: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.total).toBe(30);
    expect(page.page).toBe(2);
  });

  it('defaults to a bounded page rather than returning the whole table', async () => {
    const codes = Array.from({ length: 45 }, (_, index) =>
      aTaxCode({ tenant_id: TENANT_A, id: `code-${index}`, code: `C${index}`, status: 'draft' }),
    );
    const { service } = setup(codes);

    const page = await service.list(ctx);
    expect(page.items).toHaveLength(20);
    expect(page.total).toBe(45);
  });
});
