import { Prisma } from '@prisma/client';
import { SalesTaxSnapshotService } from './sales-tax-snapshot.service';
import { TENANT_A, contextFor } from '../identity/testing/cross-tenant-harness';

const ctx = contextFor(TENANT_A);
const service = new SalesTaxSnapshotService();

function tx() {
  return { salesTaxSnapshot: { createMany: jest.fn().mockResolvedValue({ count: 1 }) } } as any;
}

function resolution(overrides: Record<string, unknown> = {}) {
  return {
    tax_code_id: 'code-1',
    code_snapshot: 'STANDARD',
    rate_snapshot: new Prisma.Decimal('14.0000'),
    base_amount: new Prisma.Decimal(100),
    tax_amount: new Prisma.Decimal(14),
    mode_snapshot: 'exclusive' as const,
    version_snapshot: 1,
    rounding_policy_snapshot: 'line' as const,
    exemption_id: null,
    net_amount: new Prisma.Decimal(100),
    gross_amount: new Prisma.Decimal(114),
    ...overrides,
  };
}

describe('SalesTaxSnapshotService — BR-TAX-202 evidence', () => {
  it('writes one row per line carrying all six snapshot fields plus provenance', async () => {
    const t = tx();
    await service.record(ctx, t, 'invoice-1', [
      { salesInvoiceItemId: 'line-1', tax: resolution() },
    ]);

    expect(t.salesTaxSnapshot.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenant_id: TENANT_A,
          sales_invoice_id: 'invoice-1',
          sales_invoice_item_id: 'line-1',
          tax_code_id: 'code-1',
          code_snapshot: 'STANDARD',
          mode_snapshot: 'exclusive',
          version_snapshot: 1,
          rounding_policy_snapshot: 'line',
          exemption_id: null,
        }),
      ],
    });
  });

  it('writes one row per line for a multi-line document', async () => {
    const t = tx();
    await service.record(ctx, t, 'invoice-1', [
      { salesInvoiceItemId: 'line-1', tax: resolution() },
      { salesInvoiceItemId: 'line-2', tax: resolution({ tax_code_id: 'code-2' }) },
    ]);
    expect(t.salesTaxSnapshot.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('writes nothing for a document with no lines rather than issuing an empty insert', async () => {
    const t = tx();
    await service.record(ctx, t, 'invoice-1', []);
    expect(t.salesTaxSnapshot.createMany).not.toHaveBeenCalled();
  });
});

describe('SalesTaxSnapshotService — BR-TAX-205: a zero is never silent', () => {
  it('REJECTS zero tax at a real rate on a real base with no exemption attached', async () => {
    // The failure this guard exists for: a line that quietly reports no tax
    // while the rate says it owes 14%. Nothing downstream would notice.
    await expect(
      service.record(ctx, tx(), 'invoice-1', [
        { salesInvoiceItemId: 'line-1', tax: resolution({ tax_amount: new Prisma.Decimal(0) }) },
      ]),
    ).rejects.toMatchObject({ code: 'TAX_EXEMPTION_EVIDENCE_REQUIRED' });
  });

  it('names the offending line, the rate and the base so the cause is actionable', async () => {
    await expect(
      service.record(ctx, tx(), 'invoice-1', [
        { salesInvoiceItemId: 'line-42', tax: resolution({ tax_amount: new Prisma.Decimal(0) }) },
      ]),
    ).rejects.toThrow(/line-42.*14.*100/s);
  });

  it('ACCEPTS zero tax when an exemption is attached — that is evidence, not silence', async () => {
    const t = tx();
    await service.record(ctx, t, 'invoice-1', [
      {
        salesInvoiceItemId: 'line-1',
        tax: resolution({
          tax_amount: new Prisma.Decimal(0),
          rate_snapshot: new Prisma.Decimal(0),
          exemption_id: 'exemption-1',
        }),
      },
    ]);
    expect(t.salesTaxSnapshot.createMany.mock.calls[0][0].data[0].exemption_id).toBe('exemption-1');
  });

  it('ACCEPTS zero tax from a genuinely zero-rated code', async () => {
    const t = tx();
    await service.record(ctx, t, 'invoice-1', [
      {
        salesInvoiceItemId: 'line-1',
        tax: resolution({
          rate_snapshot: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(0),
        }),
      },
    ]);
    expect(t.salesTaxSnapshot.createMany).toHaveBeenCalled();
  });

  it('ACCEPTS zero tax on a zero base (a fully discounted line owes nothing)', async () => {
    const t = tx();
    await service.record(ctx, t, 'invoice-1', [
      {
        salesInvoiceItemId: 'line-1',
        tax: resolution({
          base_amount: new Prisma.Decimal(0),
          tax_amount: new Prisma.Decimal(0),
        }),
      },
    ]);
    expect(t.salesTaxSnapshot.createMany).toHaveBeenCalled();
  });

  it('rejects the WHOLE document if any one line would record a silent zero', async () => {
    const t = tx();
    await expect(
      service.record(ctx, t, 'invoice-1', [
        { salesInvoiceItemId: 'line-1', tax: resolution() },
        { salesInvoiceItemId: 'line-2', tax: resolution({ tax_amount: new Prisma.Decimal(0) }) },
      ]),
    ).rejects.toMatchObject({ code: 'TAX_EXEMPTION_EVIDENCE_REQUIRED' });
    // Nothing partial reaches the document.
    expect(t.salesTaxSnapshot.createMany).not.toHaveBeenCalled();
  });
});
