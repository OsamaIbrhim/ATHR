import type { Prisma } from '@prisma/client';
import { DEFAULT_SCALE_BARCODE_CONFIG, type ScaleBarcodeConfig } from '@athr/domain-core';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import { DEFAULT_PAYMENT_METHODS, PAYMENT_METHODS, type PaymentMethod } from '../sales/payment-methods';

/**
 * Tenant-level settings live in `Tenant.settings` (one Json column). This file
 * is the only place that knows its shape; add a setting here, not elsewhere.
 * Whatever `readTenantSettings` returns is also what a POS receives in
 * `settings` when it syncs.
 */
export interface SalesSettings {
  /** Methods a cashier may take. A POS sale that uses another is still accepted (PAYMENT_METHOD_DISABLED). */
  payment_methods: PaymentMethod[];
  /** Days after the sale a return is accepted; 0 = returns are not accepted at all. */
  return_window_days: number;
  /** The discount a cashier may give without `sales.discount.override`, as a percent of a line. */
  max_discount_percent: number;
}

export interface ReceiptSettings {
  /** Shown at the top of the receipt; the tenant name until one is set. */
  store_name: string;
  footer: string | null;
  show_tax_breakdown: boolean;
}

export interface TenantSettings {
  scale_barcode: ScaleBarcodeConfig;
  sales: SalesSettings;
  receipt: ReceiptSettings;
}

export const DEFAULT_SALES_SETTINGS: SalesSettings = {
  payment_methods: [...DEFAULT_PAYMENT_METHODS],
  return_window_days: 14,
  max_discount_percent: 10,
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * Reads the stored settings, filling anything missing (or unusable) with the
 * defaults. `tenant.name` is the store name on receipts until one is set.
 */
export function readTenantSettings(
  stored: Prisma.JsonValue | null | undefined,
  tenant: { name?: string | null } = {},
): TenantSettings {
  const raw = asObject(stored);
  const sales = asObject(raw.sales);
  const receipt = asObject(raw.receipt);
  const listed = Array.isArray(sales.payment_methods) ? (sales.payment_methods as unknown[]) : [];
  const methods = PAYMENT_METHODS.filter((method) => listed.includes(method));
  const days = typeof sales.return_window_days === 'number' ? sales.return_window_days : Number.NaN;
  const maxDiscount = typeof sales.max_discount_percent === 'number' ? sales.max_discount_percent : Number.NaN;
  return {
    scale_barcode: { ...DEFAULT_SCALE_BARCODE_CONFIG, ...((raw.scale_barcode as object) ?? {}) },
    sales: {
      payment_methods: methods.length ? methods : [...DEFAULT_SALES_SETTINGS.payment_methods],
      return_window_days: Number.isInteger(days) && days >= 0 ? days : DEFAULT_SALES_SETTINGS.return_window_days,
      max_discount_percent:
        Number.isFinite(maxDiscount) && maxDiscount >= 0 && maxDiscount <= 100
          ? maxDiscount
          : DEFAULT_SALES_SETTINGS.max_discount_percent,
    },
    receipt: {
      store_name: typeof receipt.store_name === 'string' && receipt.store_name.trim() ? receipt.store_name.trim() : (tenant.name ?? ''),
      footer: typeof receipt.footer === 'string' && receipt.footer.trim() ? receipt.footer.trim() : null,
      show_tax_breakdown: typeof receipt.show_tax_breakdown === 'boolean' ? receipt.show_tax_breakdown : true,
    },
  };
}

const invalid = (scope: string, message: string): never => {
  throw new AthrDomainError('REQUEST_FIELD_VALUE_INVALID', `${scope}: ${message}`);
};

/** Validates a scale-barcode config coming from a client or a preset. */
export function parseScaleBarcodeConfig(input: unknown): ScaleBarcodeConfig {
  const config = { ...DEFAULT_SCALE_BARCODE_CONFIG, ...((input as object) ?? {}) } as ScaleBarcodeConfig;
  const bad = (message: string): never => invalid('scale_barcode', message);
  if (typeof config.enabled !== 'boolean') bad('enabled must be true or false');
  if (!Array.isArray(config.prefixes) || !config.prefixes.every((p) => /^\d{2}$/.test(p))) {
    bad('prefixes must be two-digit strings');
  }
  if (!Number.isInteger(config.item_digits) || config.item_digits < 1 || config.item_digits > 8) {
    bad('item_digits must be between 1 and 8');
  }
  if (config.value !== 'weight' && config.value !== 'price') bad('value must be "weight" or "price"');
  if (!Number.isInteger(config.decimals) || config.decimals < 0 || config.decimals > 4) {
    bad('decimals must be between 0 and 4');
  }
  if (typeof config.price_includes_tax !== 'boolean') bad('price_includes_tax must be true or false');
  return config;
}

/**
 * Validates a change to the sale and receipt settings and returns the `sales`
 * and `receipt` objects to store. Every field is optional: what is sent
 * replaces the stored value, the rest is kept. A store name or footer sent
 * empty (or null) is cleared.
 */
export function applySalesSettingsUpdate(
  stored: Prisma.JsonValue | null | undefined,
  input: unknown,
): { sales: SalesSettings; receipt: { store_name: string | null; footer: string | null; show_tax_breakdown: boolean } } {
  const body = asObject(input);
  const sales = asObject(body.sales);
  const receipt = asObject(body.receipt);
  const current = readTenantSettings(stored);
  const next: SalesSettings = { ...current.sales };

  if (sales.payment_methods !== undefined) {
    const list = sales.payment_methods;
    if (!Array.isArray(list) || !list.length) invalid('sales.payment_methods', 'at least one payment method is required');
    const methods = list as unknown[];
    if (!methods.every((method) => (PAYMENT_METHODS as readonly string[]).includes(method as string))) {
      invalid('sales.payment_methods', `allowed values are ${PAYMENT_METHODS.join(', ')}`);
    }
    next.payment_methods = PAYMENT_METHODS.filter((method) => methods.includes(method));
  }
  if (sales.return_window_days !== undefined) {
    const days = sales.return_window_days;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 3650) {
      invalid('sales.return_window_days', 'must be a whole number of days between 0 and 3650 (0 = no returns)');
    }
    next.return_window_days = days as number;
  }
  if (sales.max_discount_percent !== undefined) {
    const percent = sales.max_discount_percent;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100 || Math.round(percent * 100) !== percent * 100) {
      invalid('sales.max_discount_percent', 'must be a number between 0 and 100 with at most 2 decimals');
    }
    next.max_discount_percent = percent as number;
  }

  const storedReceipt = asObject(asObject(stored).receipt);
  const nextReceipt = {
    store_name: typeof storedReceipt.store_name === 'string' && storedReceipt.store_name.trim() ? storedReceipt.store_name.trim() : null,
    footer: current.receipt.footer,
    show_tax_breakdown: current.receipt.show_tax_breakdown,
  };
  const text = (key: 'store_name' | 'footer', max: number) => {
    const value = receipt[key];
    if (value === undefined) return;
    if (value !== null && (typeof value !== 'string' || value.length > max)) {
      invalid(`receipt.${key}`, `must be text of at most ${max} characters, or null`);
    }
    nextReceipt[key] = typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  text('store_name', 120);
  text('footer', 300);
  if (receipt.show_tax_breakdown !== undefined) {
    if (typeof receipt.show_tax_breakdown !== 'boolean') invalid('receipt.show_tax_breakdown', 'must be true or false');
    nextReceipt.show_tax_breakdown = receipt.show_tax_breakdown as boolean;
  }
  return { sales: next, receipt: nextReceipt };
}
