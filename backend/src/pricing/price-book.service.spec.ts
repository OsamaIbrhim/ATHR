import { randomUUID } from 'crypto';
import { PriceBookRepository } from './price-book.repository';
import { PriceBookService } from './price-book.service';
import { TENANT_A, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase B (BR-PRB-1xx, Permission Matrix §17): the Price Book maker-checker lifecycle. */

const ctx = contextFor(TENANT_A);
const MAKER = randomUUID();
const CHECKER = randomUUID();

function bookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    tenant_id: TENANT_A,
    name: 'Default',
    currency: 'EGP',
    scope: 'tenant_default',
    scope_ref_id: null,
    status: 'draft',
    is_default: false,
    effective_from: null,
    effective_to: null,
    created_by: MAKER,
    submitted_by: null,
    submitted_at: null,
    approved_by: null,
    approved_at: null,
    scheduled_by: null,
    scheduled_at: null,
    activated_by: null,
    activated_at: null,
    ended_by: null,
    ended_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup(rows: ReturnType<typeof bookRow>[] = [], entryRows: Record<string, unknown>[] = []) {
  const prisma = fakePrisma({
    tenant: [{ id: TENANT_A, default_currency: 'EGP' }],
    priceBook: rows,
    priceBookEntry: entryRows,
  });
  const repository = new PriceBookRepository(prisma);
  return { prisma, repository, service: new PriceBookService(repository, prisma) };
}

describe('PriceBookService — create (BR-PRB-100, OD-CAT-005 single currency)', () => {
  it('defaults currency to the tenant\'s operating currency', async () => {
    const { service } = setup();
    const book = await service.create(ctx, MAKER, { name: 'Default' } as any);
    expect(book.currency).toBe('EGP');
  });

  it('rejects a currency other than the tenant\'s operating currency', async () => {
    const { service } = setup();
    await expect(
      service.create(ctx, MAKER, { name: 'Default', currency: 'USD' } as any),
    ).rejects.toMatchObject({ code: 'PRICING_CURRENCY_MISMATCH' });
  });
});

describe('PriceBookService — lifecycle (BR-PRB-101)', () => {
  it('walks draft -> submitted -> approved -> scheduled -> active -> ended', async () => {
    const book = bookRow();
    const { service, repository } = setup([book]);

    await service.submit(ctx, MAKER, book.id);
    let current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('submitted');
    expect(current!.submitted_by).toBe(MAKER);

    await service.approve(ctx, CHECKER, book.id);
    current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('approved');
    expect(current!.approved_by).toBe(CHECKER);

    await service.schedule(ctx, CHECKER, book.id, {});
    current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('scheduled');

    await service.activate(ctx, CHECKER, book.id);
    current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('active');
    expect(current!.activated_by).toBe(CHECKER);

    await service.end(ctx, CHECKER, book.id);
    current = await repository.findById(ctx, book.id);
    expect(current!.status).toBe('ended');
  });

  it('rejects an out-of-order transition (approve before submit)', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    await expect(service.approve(ctx, CHECKER, book.id)).rejects.toMatchObject({
      code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION',
    });
  });

  it('rejects activating a book that has not been scheduled', async () => {
    const book = bookRow({ status: 'approved', submitted_by: MAKER, approved_by: CHECKER });
    const { service } = setup([book]);
    await expect(service.activate(ctx, CHECKER, book.id)).rejects.toMatchObject({
      code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION',
    });
  });

  it('Matrix §17 "Separation": blocks the submitter from approving their own submission', async () => {
    const book = bookRow({ status: 'submitted', submitted_by: MAKER });
    const { service } = setup([book]);
    await expect(service.approve(ctx, MAKER, book.id)).rejects.toMatchObject({
      code: 'PRICING_PRICE_BOOK_SELF_APPROVAL_FORBIDDEN',
    });
  });

  it('BR-PRB-104: activating a new default book ends the previous default for the same (currency, scope)', async () => {
    const oldDefault = bookRow({
      status: 'active', is_default: true, activated_by: CHECKER,
    });
    const newDefault = bookRow({
      status: 'scheduled', is_default: true, submitted_by: MAKER, approved_by: CHECKER,
    });
    const { service, repository } = setup([oldDefault, newDefault]);

    await service.activate(ctx, CHECKER, newDefault.id);

    const oldAfter = await repository.findById(ctx, oldDefault.id);
    const newAfter = await repository.findById(ctx, newDefault.id);
    expect(oldAfter!.status).toBe('ended');
    expect(oldAfter!.is_default).toBe(false);
    expect(newAfter!.status).toBe('active');
    expect(newAfter!.is_default).toBe(true);
  });
});

describe('PriceBookService — entries (BR-PRB-102/103 versioning, BR-PSL-102/103 price validation)', () => {
  it('rejects a negative unit_price', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, MAKER, {
        price_book_id: book.id, scope_type: 'global', unit_price: -1,
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED' });
  });

  it('rejects a zero unit_price without allow_zero_price', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, MAKER, {
        price_book_id: book.id, scope_type: 'global', unit_price: 0,
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_ZERO_OR_NEGATIVE_PRICE_NOT_ALLOWED' });
  });

  it('accepts a zero unit_price with allow_zero_price (BR-PSL-102)', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    const created = await service.createEntry(ctx, MAKER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 0, allow_zero_price: true,
    } as any);
    expect(created.unit_price.toString()).toBe('0');
  });

  it('requires scope_id unless scope_type is "global"', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, MAKER, {
        price_book_id: book.id, scope_type: 'variant', unit_price: 100,
      } as any),
    ).rejects.toMatchObject({ code: 'REQUEST_FIELD_VALUE_INVALID' });
  });

  it('supersede creates a new version and marks the previous entry superseded, never edits it in place', async () => {
    const book = bookRow();
    const { service, repository } = setup([book]);
    const v1 = await service.createEntry(ctx, MAKER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
    } as any);

    const v2 = await service.supersedeEntry(ctx, MAKER, v1.id, { unit_price: 120 } as any);

    const v1After = await repository.findEntryById(ctx, v1.id);
    expect(v1After!.status).toBe('superseded');
    expect(v1After!.unit_price.toString()).toBe('100');
    expect(v1After!.superseded_by_id).toBe(v2.id);
    expect(v2.status).toBe('active');
    expect(v2.version).toBe(2);
    expect(v2.unit_price.toString()).toBe('120');
  });

  it('rejects superseding an already-superseded entry directly', async () => {
    const book = bookRow();
    const { service } = setup([book]);
    const v1 = await service.createEntry(ctx, MAKER, {
      price_book_id: book.id, scope_type: 'global', unit_price: 100,
    } as any);
    await service.supersedeEntry(ctx, MAKER, v1.id, { unit_price: 120 } as any);

    await expect(
      service.supersedeEntry(ctx, MAKER, v1.id, { unit_price: 130 } as any),
    ).rejects.toMatchObject({ code: 'PRICING_ENTRY_IMMUTABLE' });
  });

  it('rejects managing entries on an ended book', async () => {
    const book = bookRow({ status: 'ended' });
    const { service } = setup([book]);
    await expect(
      service.createEntry(ctx, MAKER, {
        price_book_id: book.id, scope_type: 'global', unit_price: 100,
      } as any),
    ).rejects.toMatchObject({ code: 'PRICING_PRICE_BOOK_INVALID_TRANSITION' });
  });
});
