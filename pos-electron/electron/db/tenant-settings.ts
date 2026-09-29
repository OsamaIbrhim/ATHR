import { DEFAULT_SCALE_BARCODE_CONFIG, type ScaleBarcodeConfig } from '@athr/domain-core'
import { getMeta } from './queries'

/** The tenant settings the server sends (first snapshot page, and deltas when they change). */
export const TENANT_SETTINGS_KEY = 'tenant_settings'

export function isValidScaleBarcodeConfig(config: any): config is ScaleBarcodeConfig {
  return (
    typeof config?.enabled === 'boolean' &&
    Array.isArray(config.prefixes) &&
    config.prefixes.every((prefix: unknown) => typeof prefix === 'string' && /^\d{2}$/.test(prefix)) &&
    Number.isInteger(config.item_digits) &&
    config.item_digits >= 1 &&
    config.item_digits <= 8 &&
    (config.value === 'weight' || config.value === 'price') &&
    Number.isInteger(config.decimals) &&
    config.decimals >= 0 &&
    config.decimals <= 4
  )
}

let cached: { raw: string; config: ScaleBarcodeConfig } | null = null

/** The stored scale-barcode config, defaults filled in like the server does; off when nothing is stored. */
export function scaleBarcodeConfig(): ScaleBarcodeConfig {
  const raw = getMeta(TENANT_SETTINGS_KEY)
  if (cached?.raw === raw) return cached.config
  let stored: unknown = null
  try {
    stored = raw ? JSON.parse(raw)?.scale_barcode : null
  } catch {
    stored = null
  }
  const merged = { ...DEFAULT_SCALE_BARCODE_CONFIG, ...((stored as object) ?? {}) }
  const config = isValidScaleBarcodeConfig(merged) ? merged : DEFAULT_SCALE_BARCODE_CONFIG
  cached = { raw, config }
  return config
}
