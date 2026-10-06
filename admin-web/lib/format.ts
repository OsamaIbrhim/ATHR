/**
 * Display formatting for numbers, money and dates (Western digits everywhere).
 * Rules: docs/design/ui/L1-onboarding.md section 0.1. lib/money.ts stays the
 * exact-arithmetic helper for the sales screens; these are display-only.
 */
export const MINUS = '−'
export const CURRENCY = 'ج.م'

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
const EXT_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹'

/** Converts Arabic-Indic digits and separators to their Western forms. */
export function toWesternDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, ch => String(ARABIC_INDIC.indexOf(ch)))
    .replace(/[۰-۹]/g, ch => String(EXT_ARABIC_INDIC.indexOf(ch)))
    .replace(/٫/g, '.')
    .replace(/٬/g, '')
    .replace(/[−‒–]/g, '-')
}

/** Parses what a person typed or pasted ("١٢٫٥", "1,250.50", "-3"). Null when it is not a plain number. */
export function parseDecimal(text: string): number | null {
  const cleaned = toWesternDigits(String(text)).replace(/[\s ]/g, '').replace(/,/g, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function decimalPlaces(text: string): number {
  const fraction = text.split('.')[1]
  return fraction ? fraction.length : 0
}

function fixed(absolute: number, decimals: number): string {
  const [int, fraction] = absolute.toFixed(decimals).split('.')
  return fraction ? `${group(int)}.${fraction}` : group(int)
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function withSign(negative: boolean, isZero: boolean, body: string, signed: boolean): string {
  if (isZero) return body
  if (negative) return `${MINUS}${body}`
  return signed ? `+${body}` : body
}

/** "1,250.00 ج.م"; negative "−1,250.00 ج.م"; deltas (signed) "+300.00 ج.م". Empty input gives "—". */
export function formatMoney(value: number | string | null | undefined, opts: { signed?: boolean; unit?: boolean } = {}): string {
  const number = toNumber(value)
  if (number === null) return '—'
  const body = fixed(Math.abs(number), 2)
  const isZero = Number(body.replace(/,/g, '')) === 0
  const text = withSign(number < 0, isZero, body, !!opts.signed)
  return opts.unit === false ? text : `${text} ${CURRENCY}`
}

/**
 * Quantity per the unit's precision: piece 0 -> "24"; kg 3 -> "1.500".
 * Without a precision, trailing zeros are dropped (max 3 decimals) so no "24.000" noise.
 */
export function formatQty(value: number | string | null | undefined, opts: { precision?: number; signed?: boolean; unit?: string } = {}): string {
  const number = toNumber(value)
  if (number === null) return '—'
  let decimals: number
  if (opts.precision !== undefined) decimals = Math.max(0, Math.min(3, opts.precision))
  else decimals = Math.min(3, decimalPlaces(String(Number(number.toFixed(3)))))
  const body = fixed(Math.abs(number), decimals)
  const isZero = Number(body.replace(/,/g, '')) === 0
  const text = withSign(number < 0, isZero, body, !!opts.signed)
  return opts.unit ? `${text} ${opts.unit}` : text
}

const TIME_ZONE = 'Africa/Cairo'

/** Date (and optional time) in Western digits, business time zone. Empty input gives "—". */
export function formatDate(value: string | number | Date | null | undefined, opts: { time?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(opts.time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date)
}

/** "2.4 ميجا" style size for file rows. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} كيلوبايت`
  return `${(bytes / 1024 / 1024).toFixed(1)} ميجا`
}
