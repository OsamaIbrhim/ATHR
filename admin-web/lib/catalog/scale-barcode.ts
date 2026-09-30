/** Tenant scale-barcode settings: GET /tenant-settings, PUT /tenant-settings/scale-barcode. */
export interface ScaleBarcodeSettings {
  enabled: boolean
  prefixes: string[]
  item_digits: number
  value: 'weight' | 'price'
  decimals: number
  price_includes_tax: boolean
}

/** Same rules as the backend's `parseScaleBarcodeConfig`, as Arabic messages. */
export function validateScaleBarcode(settings: ScaleBarcodeSettings): string[] {
  const problems: string[] = []
  if (!settings.prefixes.length) problems.push('أضف بادئة واحدة على الأقل (رقمان، مثل 20).')
  if (!settings.prefixes.every(prefix => /^\d{2}$/.test(prefix))) problems.push('كل بادئة يجب أن تكون رقمين بالضبط.')
  if (!Number.isInteger(settings.item_digits) || settings.item_digits < 1 || settings.item_digits > 8) {
    problems.push('عدد أرقام كود الصنف يجب أن يكون بين 1 و 8.')
  }
  if (!Number.isInteger(settings.decimals) || settings.decimals < 0 || settings.decimals > 4) {
    problems.push('عدد الخانات العشرية يجب أن يكون بين 0 و 4.')
  }
  return problems
}

/** A worked example of how a 13-digit label is split, shown under the form. */
export function describeLabel(settings: ScaleBarcodeSettings): string {
  const valueDigits = Math.max(0, 10 - settings.item_digits)
  const what = settings.value === 'weight' ? 'الوزن' : 'السعر'
  return `بادئة (2) + كود الصنف (${settings.item_digits}) + ${what} (${valueDigits}، منها ${settings.decimals} عشرية) + رقم التحقق (1)`
}
