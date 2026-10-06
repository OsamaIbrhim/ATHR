import { DEFAULT_PAYMENT_METHODS, PAYMENT_METHODS, type PaymentMethod } from './payment-methods'

/** The sale and receipt settings the server sends in `settings` (see the backend's `readTenantSettings`). */
export interface SaleSettings {
  payment_methods: PaymentMethod[]
  return_window_days: number
  max_discount_percent: number
}

export interface ReceiptSettings {
  store_name: string
  footer: string | null
  show_tax_breakdown: boolean
  show_branding: boolean
}

export interface PosSettings {
  sales: SaleSettings
  receipt: ReceiptSettings
}

export const DEFAULT_POS_SETTINGS: PosSettings = {
  sales: { payment_methods: [...DEFAULT_PAYMENT_METHODS], return_window_days: 14, max_discount_percent: 10 },
  receipt: { store_name: '', footer: null, show_tax_breakdown: true, show_branding: true },
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/**
 * Reads the stored `settings` JSON, filling whatever is missing or unusable with
 * the defaults. It never throws: a settings problem must not stop a sale or a
 * catalog sync (the till falls back to the defaults the server also falls back to).
 */
export function parsePosSettings(raw: unknown): PosSettings {
  const settings = asObject(raw)
  const sales = asObject(settings.sales)
  const receipt = asObject(settings.receipt)
  const listed = Array.isArray(sales.payment_methods) ? (sales.payment_methods as unknown[]) : []
  const methods = PAYMENT_METHODS.filter((method) => listed.includes(method))
  const days = sales.return_window_days
  const maxDiscount = sales.max_discount_percent
  return {
    sales: {
      payment_methods: methods.length ? methods : [...DEFAULT_POS_SETTINGS.sales.payment_methods],
      return_window_days:
        typeof days === 'number' && Number.isInteger(days) && days >= 0
          ? days
          : DEFAULT_POS_SETTINGS.sales.return_window_days,
      max_discount_percent:
        typeof maxDiscount === 'number' && Number.isFinite(maxDiscount) && maxDiscount >= 0 && maxDiscount <= 100
          ? maxDiscount
          : DEFAULT_POS_SETTINGS.sales.max_discount_percent,
    },
    receipt: {
      store_name: typeof receipt.store_name === 'string' ? receipt.store_name.trim() : '',
      footer: typeof receipt.footer === 'string' && receipt.footer.trim() ? receipt.footer.trim() : null,
      show_tax_breakdown: typeof receipt.show_tax_breakdown === 'boolean' ? receipt.show_tax_breakdown : true,
      show_branding: typeof receipt.show_branding === 'boolean' ? receipt.show_branding : true,
    },
  }
}
