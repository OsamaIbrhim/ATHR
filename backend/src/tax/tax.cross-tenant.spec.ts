import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { TaxCodeRepository } from './tax-code.repository';
import { TaxCodeService } from './tax-code.service';
import { TaxExemptionService } from './tax-exemption.service';
import { TaxResolutionService } from './tax-resolution.service';
import { aTaxCategory, aTaxCode, taxCategoryIdFor } from '../identity/testing/fixture-builders';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/**
 * WP-008 Phase C — cross-tenant isolation for every table this phase adds:
 * `TaxCategory`, `TaxCode`, `TaxExemption`, `SalesTaxSnapshot`
 * (Multi-tenancy Blueprint §32/§123, same pattern as Phases A and B).
 */

const CATEGORY_A = taxCategoryIdFor(TENANT_A);
const CATEGORY_B = taxCategoryIdFor(TENANT_B);
const CODE_A = randomUUID();
const CODE_B = randomUUID();
const CUSTOMER_A = randomUUID();
const CUSTOMER_B = randomUUID();
const EXEMPTION_A = randomUUID();
const EXEMPTION_B = randomUUID();
const ACTOR = randomUUID();

function setup() {
  const prisma = fakePrisma({
    taxCategory: [
      aTaxCategory({ tenant_id: TENANT_A }),
      aTaxCategory({ tenant_id: TENANT_B }),
    ],
    taxCode: [
      aTaxCode({ id: CODE_A, tenant_id: TENANT_A, status: 'active', rate: new Prisma.Decimal(14) }),
      aTaxCode({ id: CODE_B, tenant_id: TENANT_B, status: 'active', rate: new Prisma.Decimal(5) }),
    ],
    customer: [
      { id: CUSTOMER_A, tenant_id: TENANT_A, phone: '1' },
      { id: CUSTOMER_B, tenant_id: TENANT_B, phone: '2' },
    ],
    taxExemption: [
      {
        id: EXEMPTION_A,
        tenant_id: TENANT_A,
        customer_id: CUSTOMER_A,
        tax_category_id: null,
        status: 'approved',
        reason: 'A',
        evidence_reference: 'CERT-A',
        evidence_issued_at: new Date(),
        expires_at: null,
        applied_by: ACTOR,
        created_at: new Date(),
      },
      {
        id: EXEMPTION_B,
        tenant_id: TENANT_B,
        customer_id: CUSTOMER_B,
        tax_category_id: null,
        status: 'approved',
        reason: 'B',
        evidence_reference: 'CERT-B',
        evidence_issued_at: new Date(),
        expires_at: null,
        applied_by: ACTOR,
        created_at: new Date(),
      },
    ],
    salesTaxSnapshot: [
      { id: randomUUID(), tenant_id: TENANT_A, sales_invoice_id: 'inv-a', tax_code_id: CODE_A },
      { id: randomUUID(), tenant_id: TENANT_B, sales_invoice_id: 'inv-b', tax_code_id: CODE_B },
    ],
  });
  const repository = new TaxCodeRepository(prisma);
  return {
    prisma,
    repository,
    codes: new TaxCodeService(repository),
    exemptions: new TaxExemptionService(prisma),
    resolution: new TaxResolutionService(prisma),
  };
}

describe('TaxCategory — cross-tenant isolation', () => {
  it("lists only the calling tenant's categories", async () => {
    const { codes } = setup();
    const a = await codes.listCategories(contextFor(TENANT_A));
    const b = await codes.listCategories(contextFor(TENANT_B));

    expect(a.items.map((row) => row.id)).toEqual([CATEGORY_A]);
    expect(b.items.map((row) => row.id)).toEqual([CATEGORY_B]);
  });

  it("does not resolve another tenant's category by id", async () => {
    const { repository } = setup();
    expect(await repository.findCategoryById(contextFor(TENANT_B), CATEGORY_A)).toBeNull();
  });

  it("rejects creating a TaxCode against another tenant's category as NOT FOUND", async () => {
    // Reads as "not found", never "forbidden": the latter would confirm the id
    // exists somewhere (Blueprint §32).
    const { codes } = setup();
    await expect(
      codes.create(contextFor(TENANT_B), ACTOR, {
        tax_category_id: CATEGORY_A,
        code: 'X',
        name_en: 'X',
        rate: 14,
        tax_mode: 'exclusive',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('TaxCode — cross-tenant isolation', () => {
  it("lists only the calling tenant's codes", async () => {
    const { codes } = setup();
    expect((await codes.list(contextFor(TENANT_A))).items.map((r) => r.id)).toEqual([CODE_A]);
    expect((await codes.list(contextFor(TENANT_B))).items.map((r) => r.id)).toEqual([CODE_B]);
  });

  it("does not resolve another tenant's code by id", async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_B), CODE_A)).toBeNull();
    await expect(repository.assertInTenant(contextFor(TENANT_B), CODE_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it("cannot transition another tenant's code", async () => {
    const { codes } = setup();
    await expect(codes.submit(contextFor(TENANT_B), ACTOR, CODE_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it("cannot activate another tenant's code", async () => {
    const { codes } = setup();
    await expect(codes.activate(contextFor(TENANT_B), ACTOR, CODE_A)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it("never resolves another tenant's active code, even for a colliding category id", async () => {
    // The sharp case: if resolution keyed on category alone, tenant B would be
    // taxed at tenant A's rate.
    const { repository } = setup();
    expect(await repository.findActiveForCategory(contextFor(TENANT_B), CATEGORY_A)).toBeNull();
  });

  it("the active-code index for one tenant never contains another tenant's rate", async () => {
    const { resolution } = setup();
    const indexA = await resolution.loadActiveCodeIndex(contextFor(TENANT_A));
    const indexB = await resolution.loadActiveCodeIndex(contextFor(TENANT_B));

    expect([...indexA.values()].map((code) => code.id)).toEqual([CODE_A]);
    expect([...indexB.values()].map((code) => code.id)).toEqual([CODE_B]);
    expect(indexB.get(CATEGORY_A)).toBeUndefined();
  });
});

describe('TaxExemption — cross-tenant isolation', () => {
  it("lists only the calling tenant's exemptions", async () => {
    const { exemptions } = setup();
    expect((await exemptions.list(contextFor(TENANT_A))).items.map((r) => r.id)).toEqual([
      EXEMPTION_A,
    ]);
    expect((await exemptions.list(contextFor(TENANT_B))).items.map((r) => r.id)).toEqual([
      EXEMPTION_B,
    ]);
  });

  it("does not resolve another tenant's exemption by id", async () => {
    const { exemptions } = setup();
    expect(await exemptions.findById(contextFor(TENANT_B), EXEMPTION_A)).toBeNull();
  });

  it("cannot approve another tenant's exemption", async () => {
    const { exemptions } = setup();
    await expect(
      exemptions.approve(contextFor(TENANT_B), ACTOR, EXEMPTION_A),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it("cannot revoke another tenant's exemption", async () => {
    const { exemptions } = setup();
    await expect(
      exemptions.revoke(contextFor(TENANT_B), ACTOR, EXEMPTION_A, { reason: 'nope' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it("cannot apply an exemption for another tenant's customer", async () => {
    const { exemptions } = setup();
    await expect(
      exemptions.apply(contextFor(TENANT_B), ACTOR, {
        customer_id: CUSTOMER_A,
        reason: 'Diplomatic',
        evidence_reference: 'CERT-X',
        evidence_issued_at: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it("cannot scope an exemption to another tenant's tax category", async () => {
    const { exemptions } = setup();
    await expect(
      exemptions.apply(contextFor(TENANT_B), ACTOR, {
        customer_id: CUSTOMER_B,
        tax_category_id: CATEGORY_A,
        reason: 'Diplomatic',
        evidence_reference: 'CERT-X',
        evidence_issued_at: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('stamps a newly applied exemption with the CALLING tenant', async () => {
    const { exemptions } = setup();
    const created = await exemptions.apply(contextFor(TENANT_B), ACTOR, {
      customer_id: CUSTOMER_B,
      reason: 'Diplomatic',
      evidence_reference: 'CERT-X',
      evidence_issued_at: new Date().toISOString(),
    });
    expect(created.tenant_id).toBe(TENANT_B);
    // Always pending: applying and approving are separate Matrix §18 keys.
    expect(created.status).toBe('pending');
  });
});

describe('SalesTaxSnapshot — cross-tenant isolation', () => {
  it("a tenant's snapshot rows are never visible to another tenant", async () => {
    const { prisma } = setup();
    const forB = await prisma.salesTaxSnapshot.findMany({ where: { tenant_id: TENANT_B } });
    expect(forB.map((row: any) => row.sales_invoice_id)).toEqual(['inv-b']);
    expect(forB.some((row: any) => row.tax_code_id === CODE_A)).toBe(false);
  });
});
