import { priceSale, type DiscountSpec, type SaleLineInput, type SaleLineResult } from '@athr/domain-core';
import { Prisma } from '@prisma/client';

export type SaleDiscount = DiscountSpec & { readonly value: number };

/**
 * A discount from a till, cleaned rather than validated: a sale that was
 * finished is never refused over its discount, so anything unusable is simply
 * "no discount". Percent has up to 4 decimals, an amount up to 2.
 */
export function cleanDiscount(value: unknown): SaleDiscount | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { type, value: raw } = value as { type?: unknown; value?: unknown };
  const number = typeof raw === 'string' ? Number(raw) : raw;
  if ((type !== 'amount' && type !== 'percent') || typeof number !== 'number' || !Number.isFinite(number) || number <= 0) {
    return undefined;
  }
  const places = type === 'percent' ? 4 : 2;
  const rounded = Number(number.toFixed(places));
  return rounded > 0 ? { type, value: rounded } : undefined;
}

/** The discount in the form the command fingerprint hashes. */
export function discountFingerprint(discount: SaleDiscount) {
  return { type: discount.type, value: discount.value.toFixed(discount.type === 'percent' ? 4 : 2) };
}

export interface PricingLine {
  readonly variantId: string;
  readonly qty: number | string;
  readonly unitPrice: number | string;
  readonly unitTax: number | string;
  readonly taxRate: number | string;
  readonly taxMode: 'inclusive' | 'exclusive';
  readonly discount?: SaleDiscount;
}

/** What one variant of the invoice carries once its lines (there can be several) are priced. */
export interface PricedVariant {
  readonly net: Prisma.Decimal;
  readonly tax: Prisma.Decimal;
  /** Tax-exclusive discount: the lines' own plus their shares of the invoice discount. */
  readonly discount: Prisma.Decimal;
}

export interface SalePricing {
  readonly subtotal: Prisma.Decimal;
  readonly discountTotal: Prisma.Decimal;
  readonly taxTotal: Prisma.Decimal;
  readonly total: Prisma.Decimal;
  readonly lines: readonly SaleLineResult[];
  readonly byVariant: ReadonlyMap<string, PricedVariant>;
}

/**
 * Prices the lines of a sale as the till does (`@athr/domain-core`: discounts,
 * tax after discount, the invoice discount spread over the lines) and rolls the
 * result up per variant, because an invoice keeps one row per variant.
 */
export function priceSaleLines(lines: readonly PricingLine[], invoiceDiscount?: SaleDiscount): SalePricing {
  const inputs: SaleLineInput[] = lines.map((line) => ({
    qty: line.qty,
    unitPrice: line.unitPrice,
    unitTax: line.unitTax,
    taxRate: line.taxRate,
    taxMode: line.taxMode,
    discount: line.discount ?? null,
  }));
  const priced = priceSale(inputs, invoiceDiscount ?? null);

  const byVariant = new Map<string, PricedVariant>();
  priced.lines.forEach((result, index) => {
    const variantId = lines[index]!.variantId;
    const before = byVariant.get(variantId);
    byVariant.set(variantId, {
      net: (before?.net ?? new Prisma.Decimal(0)).plus(result.net),
      tax: (before?.tax ?? new Prisma.Decimal(0)).plus(result.tax),
      discount: (before?.discount ?? new Prisma.Decimal(0)).plus(result.discountNet),
    });
  });
  return {
    subtotal: new Prisma.Decimal(priced.totals.subtotal),
    discountTotal: new Prisma.Decimal(priced.totals.discountTotal),
    taxTotal: new Prisma.Decimal(priced.totals.taxTotal),
    total: new Prisma.Decimal(priced.totals.total),
    lines: priced.lines,
    byVariant,
  };
}

/**
 * The largest discount, in percent of a line, this staff member may give
 * without it being flagged: nothing without `sales.discount.apply`, the tenant
 * limit with it, anything with `sales.discount.override`. A staff member the
 * server cannot identify gets the tenant limit, never a refusal.
 */
export function discountLimitPercent(permissions: ReadonlySet<string> | null, tenantMaxPercent: number): number {
  if (!permissions) return tenantMaxPercent;
  if (permissions.has('sales.discount.override')) return 100;
  return permissions.has('sales.discount.apply') ? tenantMaxPercent : 0;
}

