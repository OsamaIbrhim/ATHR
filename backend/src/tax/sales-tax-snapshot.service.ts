import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { decimal } from '../common/money';
import type { TenantScope } from '../identity/tenant-context.type';
import type { TaxResolution } from './tax-resolution.service';

export interface SnapshotLine {
  readonly salesInvoiceItemId: string;
  readonly tax: TaxResolution;
}

/**
 * WP-008 Phase C — writes the BR-TAX-202 snapshot rows for a sales document.
 *
 * This is the whole point of the phase. Once these rows are written, a later
 * rate change cannot alter what this document reports: nothing joins back to
 * `TaxCode` to render a historical invoice, and migration `202608130007`
 * installs a BEFORE UPDATE trigger that rejects any attempt to rewrite a row
 * here (an application-layer "we never update this" convention was not
 * considered sufficient — Phase B shipped a permission key that was declared,
 * granted, and enforced at zero call sites).
 */
@Injectable()
export class SalesTaxSnapshotService {
  /**
   * BR-TAX-205 — the guard that makes an exemption auditable rather than a
   * silent zero. A zero tax amount is only ever legitimate when either the
   * resolved rate really is zero, or an exemption row is attached. A zero
   * produced any other way is rejected before it can reach a document.
   */
  private assertNoSilentZero(line: SnapshotLine): void {
    const taxAmount = decimal(line.tax.tax_amount);
    const rate = decimal(line.tax.rate_snapshot);
    const base = decimal(line.tax.base_amount);

    // Zero tax is legitimate in exactly three cases: the code is genuinely
    // zero-rated, there is nothing to tax, or an exemption is attached. Zero
    // tax at a real rate on a real base with no exemption is the silent zero
    // BR-TAX-205 forbids.
    const legitimate =
      !taxAmount.isZero() || rate.isZero() || base.isZero() || line.tax.exemption_id !== null;
    if (legitimate) return;

    throw new AthrDomainError(
      'TAX_EXEMPTION_EVIDENCE_REQUIRED',
      `Invoice line ${line.salesInvoiceItemId} would record zero tax at a ${rate.toString()}% rate on a base of ${base.toString()} with no exemption attached. A zero is only valid with recorded evidence (BR-TAX-205).`,
    );
  }

  /**
   * Writes one row per (line, tax component). Must be called inside the same
   * transaction that creates the invoice — a document that exists without its
   * tax evidence is exactly the state BR-TAX-202 forbids.
   */
  async record(
    context: TenantScope,
    tx: Prisma.TransactionClient,
    salesInvoiceId: string,
    lines: readonly SnapshotLine[],
  ): Promise<void> {
    for (const line of lines) this.assertNoSilentZero(line);

    if (!lines.length) return;

    await tx.salesTaxSnapshot.createMany({
      data: lines.map((line) => ({
        tenant_id: context.tenantId,
        sales_invoice_id: salesInvoiceId,
        sales_invoice_item_id: line.salesInvoiceItemId,
        tax_code_id: line.tax.tax_code_id,
        code_snapshot: line.tax.code_snapshot,
        rate_snapshot: line.tax.rate_snapshot,
        base_amount: line.tax.base_amount,
        tax_amount: line.tax.tax_amount,
        mode_snapshot: line.tax.mode_snapshot,
        version_snapshot: line.tax.version_snapshot,
        rounding_policy_snapshot: line.tax.rounding_policy_snapshot,
        exemption_id: line.tax.exemption_id,
      })),
    });
  }
}
