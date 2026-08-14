import { Prisma } from '@prisma/client';
import { TaxResolutionService } from './tax-resolution.service';
import { aTaxCode, taxCategoryIdFor } from '../identity/testing/fixture-builders';
import { TENANT_A, TENANT_B, contextFor } from '../identity/testing/cross-tenant-harness';

const ctx = contextFor(TENANT_A);
const CATEGORY_A = taxCategoryIdFor(TENANT_A);
const OTHER_CATEGORY = taxCategoryIdFor(TENANT_B);

const service = new TaxResolutionService({} as any);

const code = (overrides: Record<string, unknown> = {}) =>
  aTaxCode({ tax_category_id: CATEGORY_A, ...overrides }) as any;

describe('TaxResolutionService — inclusive vs. exclusive per price context (BR-TAX-204)', () => {
  it('EXCLUSIVE: adds tax on top of the authored price', () => {
    const result = service.calculate(code({ rate: new Prisma.Decimal('14') }), 100, 'exclusive');

    expect(result.net_amount.toNumber()).toBe(100);
    expect(result.tax_amount.toNumber()).toBe(14);
    expect(result.gross_amount.toNumber()).toBe(114);
    expect(result.mode_snapshot).toBe('exclusive');
  });

  it('INCLUSIVE: extracts the tax already contained in the authored price', () => {
    // 114 gross at 14% -> 100 net + 14 tax. The customer pays the same 114
    // either way; what differs is which number the price context stored.
    const result = service.calculate(code({ rate: new Prisma.Decimal('14') }), 114, 'inclusive');

    expect(result.net_amount.toNumber()).toBe(100);
    expect(result.tax_amount.toNumber()).toBe(14);
    expect(result.gross_amount.toNumber()).toBe(114);
    expect(result.mode_snapshot).toBe('inclusive');
  });

  it('the two modes are NOT interchangeable — the same number means different money', () => {
    const exclusive = service.calculate(code(), 100, 'exclusive');
    const inclusive = service.calculate(code(), 100, 'inclusive');

    // This is exactly why `tax_mode` has no database default and no default
    // argument: reading 100 under the wrong mode misprices the line by 14.
    expect(exclusive.gross_amount.toNumber()).toBe(114);
    expect(inclusive.gross_amount.toNumber()).toBe(100);
    expect(exclusive.tax_amount.toNumber()).not.toBe(inclusive.tax_amount.toNumber());
  });

  it('INCLUSIVE: net + tax reproduces the authored gross exactly, with no rounding drift', () => {
    // A price that does not divide cleanly by 1.14 — computing tax as
    // `gross x rate / (1 + rate)` and rounding independently would leave
    // net + tax a cent away from the shelf price.
    for (const gross of [99.99, 0.01, 1234.57, 7.77, 19.95]) {
      const result = service.calculate(code(), gross, 'inclusive');
      expect(result.net_amount.plus(result.tax_amount).toNumber()).toBe(gross);
    }
  });

  it('EXCLUSIVE: net + tax reproduces the computed gross exactly', () => {
    for (const net of [99.99, 0.01, 1234.57, 7.77, 19.95]) {
      const result = service.calculate(code(), net, 'exclusive');
      expect(result.net_amount.plus(result.tax_amount).toNumber()).toBe(
        result.gross_amount.toNumber(),
      );
    }
  });

  it('records the six BR-TAX-202 snapshot fields on every resolution', () => {
    const active = code({ rate: new Prisma.Decimal('5.5'), version: 3, code: 'REDUCED' });
    const result = service.calculate(active, 200, 'exclusive');

    expect(result.code_snapshot).toBe('REDUCED');
    expect(result.rate_snapshot.toString()).toBe('5.5');
    expect(result.base_amount.toNumber()).toBe(200);
    expect(result.tax_amount.toNumber()).toBe(11);
    expect(result.mode_snapshot).toBe('exclusive');
    expect(result.version_snapshot).toBe(3);
    expect(result.tax_code_id).toBe(active.id);
    expect(result.rounding_policy_snapshot).toBe('line');
  });

  it('a genuinely zero-rated code produces zero tax without an exemption', () => {
    const result = service.calculate(code({ rate: new Prisma.Decimal(0) }), 100, 'exclusive');
    expect(result.tax_amount.toNumber()).toBe(0);
    expect(result.exemption_id).toBeNull();
  });
});

describe('TaxResolutionService — category resolution (OD-CAT-014)', () => {
  it('uses the product-level default when the variant declares no override', () => {
    expect(
      service.resolveCategoryId({
        id: 'v1',
        tax_category_id: null,
        product: { tax_category_id: CATEGORY_A },
      }),
    ).toBe(CATEGORY_A);
  });

  it("a variant-level override wins over the product's default", () => {
    expect(
      service.resolveCategoryId({
        id: 'v1',
        tax_category_id: OTHER_CATEGORY,
        product: { tax_category_id: CATEGORY_A },
      }),
    ).toBe(OTHER_CATEGORY);
  });

  it('throws rather than producing an untaxed line when neither carries a category', () => {
    expect(() =>
      service.resolveCategoryId({ id: 'v1', tax_category_id: null, product: {} }),
    ).toThrow(/resolves to no tax category/);
  });
});

describe('TaxResolutionService — BR-TAX-201: no active code blocks, never zero-rates', () => {
  const prisma = { taxCode: { findFirst: jest.fn().mockResolvedValue(null) } };

  it('resolveForVariant throws TAX_NO_ACTIVE_CODE instead of returning a zero-rated line', async () => {
    await expect(
      new TaxResolutionService(prisma as any).resolveForVariant(
        ctx,
        { id: 'v1', tax_category_id: null, product: { tax_category_id: CATEGORY_A } },
        100,
        'exclusive',
      ),
    ).rejects.toMatchObject({ code: 'TAX_NO_ACTIVE_CODE' });
  });

  it('prefers a supplied index over a query, so a batch resolves one version for every line', async () => {
    const findFirst = jest.fn();
    const active = code();
    const result = await new TaxResolutionService({ taxCode: { findFirst } } as any).resolveForVariant(
      ctx,
      { id: 'v1', tax_category_id: null, product: { tax_category_id: CATEGORY_A } },
      100,
      'exclusive',
      { index: new Map([[CATEGORY_A, active]]) },
    );
    expect(findFirst).not.toHaveBeenCalled();
    expect(result.tax_code_id).toBe(active.id);
  });
});

describe('TaxResolutionService — exemptions require applicable, evidenced grounds (BR-TAX-205)', () => {
  const at = new Date('2026-08-14T00:00:00.000Z');
  const exemption = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'exemption-1',
      customer_id: 'customer-1',
      tax_category_id: null,
      status: 'approved',
      expires_at: null,
      ...overrides,
    }) as any;

  it('accepts an approved, unexpired exemption for this customer', () => {
    expect(() =>
      service.assertExemptionApplicable(exemption(), {
        customerId: 'customer-1',
        taxCategoryId: CATEGORY_A,
        at,
      }),
    ).not.toThrow();
  });

  it('rejects a PENDING exemption — approval is a separate, independent decision', () => {
    expect(() =>
      service.assertExemptionApplicable(exemption({ status: 'pending' }), {
        customerId: 'customer-1',
        taxCategoryId: CATEGORY_A,
        at,
      }),
    ).toThrow(/only an approved exemption zero-rates a line/);
  });

  it('rejects a revoked exemption', () => {
    expect(() =>
      service.assertExemptionApplicable(exemption({ status: 'revoked' }), {
        customerId: 'customer-1',
        taxCategoryId: CATEGORY_A,
        at,
      }),
    ).toThrow(/revoked/);
  });

  it("rejects another customer's exemption", () => {
    expect(() =>
      service.assertExemptionApplicable(exemption(), {
        customerId: 'customer-2',
        taxCategoryId: CATEGORY_A,
        at,
      }),
    ).toThrow(/different customer/);
  });

  it('rejects an anonymous (walk-in) sale — an exemption is bound to a customer', () => {
    expect(() =>
      service.assertExemptionApplicable(exemption(), {
        customerId: null,
        taxCategoryId: CATEGORY_A,
        at,
      }),
    ).toThrow(/different customer/);
  });

  it("rejects an exemption scoped to a different category than the line's", () => {
    expect(() =>
      service.assertExemptionApplicable(exemption({ tax_category_id: OTHER_CATEGORY }), {
        customerId: 'customer-1',
        taxCategoryId: CATEGORY_A,
        at,
      }),
    ).toThrow(/does not cover this line's tax category/);
  });

  it('rejects an exemption whose evidence has expired', () => {
    expect(() =>
      service.assertExemptionApplicable(
        exemption({ expires_at: new Date('2026-08-13T00:00:00.000Z') }),
        { customerId: 'customer-1', taxCategoryId: CATEGORY_A, at },
      ),
    ).toThrow(/expired/);
  });

  it('an applied exemption zero-rates the line and records WHICH evidence justified it', () => {
    const result = service.calculate(code(), 100, 'exclusive', exemption());

    expect(result.tax_amount.toNumber()).toBe(0);
    expect(result.rate_snapshot.toNumber()).toBe(0);
    // The point of BR-TAX-205: the zero is never anonymous.
    expect(result.exemption_id).toBe('exemption-1');
  });

  it('under an INCLUSIVE context an exempt customer pays the extracted net, not the shelf gross', () => {
    // Otherwise the customer is charged a tax they are exempt from and it is
    // booked as revenue. See the decision note in `calculate`.
    const result = service.calculate(code(), 114, 'inclusive', exemption());

    expect(result.tax_amount.toNumber()).toBe(0);
    expect(result.net_amount.toNumber()).toBe(100);
    expect(result.gross_amount.toNumber()).toBe(100);
  });
});
