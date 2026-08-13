import { Injectable } from '@nestjs/common';
import { Prisma, type TaxCode, type TaxExemption, type TaxMode, type TaxRoundingPolicy } from '@prisma/client';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { decimal, money } from '../common/money';
import type { TenantScope } from '../identity/tenant-context.type';
import { PrismaService } from '../prisma/prisma.service';

/** The minimum a caller must know about a variant to resolve its tax category. */
export interface TaxableVariant {
  readonly id: string;
  readonly tax_category_id?: string | null;
  readonly product: { readonly tax_category_id?: string | null };
}

/** The resolved, snapshot-ready tax for one line (BR-TAX-202's six fields plus provenance). */
export interface TaxResolution {
  readonly tax_code_id: string;
  readonly code_snapshot: string;
  readonly rate_snapshot: Prisma.Decimal;
  readonly base_amount: Prisma.Decimal;
  readonly tax_amount: Prisma.Decimal;
  readonly mode_snapshot: TaxMode;
  readonly version_snapshot: number;
  readonly rounding_policy_snapshot: TaxRoundingPolicy;
  readonly exemption_id: string | null;
  /**
   * The tax-exclusive net for this line. Equal to the authored price under
   * `exclusive`; the extracted net under `inclusive`. This is what a caller
   * should report as `net_price`, never the raw authored price.
   */
  readonly net_amount: Prisma.Decimal;
  /** net + tax. Equal to the authored price under `inclusive`. */
  readonly gross_amount: Prisma.Decimal;
}

/** Active codes keyed by `tax_category_id` — built once for bulk paths. */
export type TaxCodeIndex = ReadonlyMap<string, TaxCode>;

/**
 * WP-008 Phase C — resolves *which* tax applies and *how much* it is
 * (BR-TAX-201/202/204/205).
 *
 * This service deliberately does **not** decide jurisdiction. OD-CAT-006 (BR
 * doc §35 numbering) fixes the MVP at versioned codes plus inclusive/exclusive
 * with no jurisdiction-determination engine, and `TaxCode.jurisdiction` is
 * recorded on the snapshot rather than resolved from anything.
 */
@Injectable()
export class TaxResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * OD-CAT-014: "Default tax category على Product مع Override مصرح على
   * Variant". A non-null variant category is an override and wins; null means
   * inherit, which is the only way to tell an override apart from a
   * restatement of the product default.
   */
  resolveCategoryId(variant: TaxableVariant): string {
    const categoryId = variant.tax_category_id ?? variant.product.tax_category_id ?? null;
    if (!categoryId) {
      // Unreachable while `Product.tax_category_id` is NOT NULL, but a
      // caller passing a partially-selected variant would otherwise silently
      // produce an untaxed line — the exact failure mode this phase exists
      // to remove.
      throw new AthrDomainError(
        'TAX_NO_ACTIVE_CODE',
        `Variant ${variant.id} resolves to no tax category; neither the variant nor its product carries one.`,
      );
    }
    return categoryId;
  }

  /** Every active code in the tenant, keyed by category, for bulk paths. */
  async loadActiveCodeIndex(
    context: TenantScope,
    transaction?: Prisma.TransactionClient,
  ): Promise<TaxCodeIndex> {
    const db = transaction ?? this.prisma;
    const codes = await db.taxCode.findMany({
      where: { tenant_id: context.tenantId, status: 'active' },
    });
    return new Map(codes.map((code) => [code.tax_category_id, code]));
  }

  /**
   * BR-TAX-204 — the inclusive/exclusive split, and the only place it happens.
   *
   * `authoredAmount` is the line amount exactly as the price context stored
   * it, and `contextMode` says what that number means. Getting this backwards
   * is a ~12% error on every line, so the mode is a required argument with no
   * default: a caller that does not know it cannot call this.
   *
   *   exclusive: authored = net;   tax = net × rate
   *   inclusive: authored = gross; tax = gross − gross ÷ (1 + rate)
   *
   * The inclusive form is written as `gross − net` rather than the equivalent
   * `gross × rate ÷ (1 + rate)` on purpose: rounding `net` once and
   * subtracting guarantees `net + tax === gross` exactly, so an inclusive line
   * can never display a total a cent away from the price on the shelf.
   */
  calculate(
    code: TaxCode,
    authoredAmount: Prisma.Decimal.Value,
    contextMode: TaxMode,
    exemption: TaxExemption | null = null,
  ): TaxResolution {
    const authored = money(authoredAmount);
    const rate = decimal(code.rate);

    if (exemption) {
      // BR-TAX-205: a zero is only legitimate with evidence attached. The
      // exemption's applicability is validated by `assertExemptionApplicable`
      // before it reaches here; this method records it.
      //
      // Under an INCLUSIVE context the authored amount is a gross that
      // contains tax at the ordinary rate, so an exemption cannot simply set
      // tax to zero and leave the number alone — that would charge the
      // customer a tax they are exempt from and book it as revenue. The net
      // is extracted first and the customer pays that.
      //
      // The BR doc does not state which of the two readings applies (pay the
      // shelf price with the tax reclassified, or pay the extracted net), so
      // this is a decision, not a derivation — it is flagged in the Phase C
      // PR description rather than left implicit here. The chosen reading is
      // the one where an exempt customer is never charged tax.
      const net =
        contextMode === 'inclusive'
          ? money(authored.div(decimal(1).plus(rate.div(100))))
          : authored;
      return {
        tax_code_id: code.id,
        code_snapshot: code.code,
        rate_snapshot: decimal(0),
        base_amount: net,
        tax_amount: money(0),
        mode_snapshot: contextMode,
        version_snapshot: code.version,
        rounding_policy_snapshot: code.rounding_policy,
        exemption_id: exemption.id,
        net_amount: net,
        gross_amount: net,
      };
    }

    let net: Prisma.Decimal;
    let tax: Prisma.Decimal;
    let gross: Prisma.Decimal;

    if (contextMode === 'inclusive') {
      gross = authored;
      net = money(gross.div(decimal(1).plus(rate.div(100))));
      tax = money(gross.minus(net));
    } else {
      net = authored;
      tax = money(net.mul(rate).div(100));
      gross = money(net.plus(tax));
    }

    return {
      tax_code_id: code.id,
      code_snapshot: code.code,
      rate_snapshot: rate,
      base_amount: net,
      tax_amount: tax,
      mode_snapshot: contextMode,
      version_snapshot: code.version,
      rounding_policy_snapshot: code.rounding_policy,
      exemption_id: null,
      net_amount: net,
      gross_amount: gross,
    };
  }

  /**
   * Looks up the active code for a variant's category and calculates.
   * Throws rather than returning a zero-rated line when no code is active
   * (BR-TAX-201) — the Phase B precedent that a missing price blocks the sale
   * applies identically to a missing rate.
   */
  async resolveForVariant(
    context: TenantScope,
    variant: TaxableVariant,
    authoredAmount: Prisma.Decimal.Value,
    contextMode: TaxMode,
    options: { index?: TaxCodeIndex; exemption?: TaxExemption | null; transaction?: Prisma.TransactionClient } = {},
  ): Promise<TaxResolution> {
    const categoryId = this.resolveCategoryId(variant);
    const code =
      options.index?.get(categoryId) ??
      (await (options.transaction ?? this.prisma).taxCode.findFirst({
        where: { tenant_id: context.tenantId, tax_category_id: categoryId, status: 'active' },
      }));

    if (!code) {
      throw new AthrDomainError(
        'TAX_NO_ACTIVE_CODE',
        `No active tax code for category ${categoryId} (variant ${variant.id}). A rate must be activated before this item can be sold.`,
      );
    }
    return this.calculate(code, authoredAmount, contextMode, options.exemption ?? null);
  }

  /**
   * BR-TAX-205 — an exemption is only applicable if it is approved, unexpired,
   * belongs to this customer, and covers this category. Anything else is
   * rejected rather than quietly ignored: silently falling back to the full
   * rate would be as wrong as silently zero-rating, because the operator
   * believes an exemption was applied.
   */
  assertExemptionApplicable(
    exemption: TaxExemption,
    input: { customerId: string | null; taxCategoryId: string; at: Date },
  ): void {
    const reject = (why: string): never => {
      throw new AthrDomainError(
        'TAX_EXEMPTION_NOT_APPLICABLE',
        `Tax exemption ${exemption.id} cannot be applied: ${why}.`,
      );
    };

    if (exemption.status !== 'approved') {
      reject(`its status is "${exemption.status}", and only an approved exemption zero-rates a line`);
    }
    if (!input.customerId || exemption.customer_id !== input.customerId) {
      reject('it belongs to a different customer than this document');
    }
    if (exemption.tax_category_id && exemption.tax_category_id !== input.taxCategoryId) {
      reject('it does not cover this line\'s tax category');
    }
    if (exemption.expires_at && exemption.expires_at.getTime() <= input.at.getTime()) {
      reject(`its evidence expired on ${exemption.expires_at.toISOString()}`);
    }
  }

  /**
   * BR-TAX-206 — manual tax override is forbidden by default.
   *
   * There is deliberately no free tax-amount parameter anywhere in this
   * service. The BR is explicit that a correction is made by changing tax
   * eligibility or issuing an authorised corrective document, "لا مبلغ ضريبة
   * حر" — not a free tax amount. So this guard exists to *reject*, and the
   * `tax.calculation.override` key it names is granted to no role by any
   * default template (`DENY_BY_DEFAULT_PERMISSIONS`).
   *
   * See the Phase C PR description: the tension between "the Matrix declares
   * an override key" and "the BR forbids a free tax amount" is flagged there
   * rather than resolved by quietly building the free-amount path.
   */
  assertManualOverrideAllowed(permissions: readonly string[]): void {
    if (!permissions.includes('tax.calculation.override')) {
      throw new AthrDomainError(
        'TAX_MANUAL_OVERRIDE_FORBIDDEN',
        'Manual tax override is denied by default (BR-TAX-206). Correct the tax by changing the item\'s tax category or eligibility, or issue an authorised corrective document — a free tax amount is never accepted.',
      );
    }
  }
}
