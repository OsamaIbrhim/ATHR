import { toWesternDigits } from './format'

/**
 * Cleans what a person types into a quantity/money box: Arabic-Indic digits
 * become Western, anything that is not a digit, one decimal point or (when
 * allowed) a leading minus is dropped, and decimals beyond `precision` are cut.
 */
export function sanitizeNumberText(text: string, opts: { precision: number; allowSign?: boolean }): string {
  const western = toWesternDigits(text).replace(/,/g, '.')
  let negative = false
  let body = ''
  let seenDot = false
  let decimals = 0
  for (const ch of western) {
    if (ch === '-' && opts.allowSign && body === '' && !negative) { negative = true; continue }
    if (ch >= '0' && ch <= '9') {
      if (seenDot) { if (decimals >= opts.precision) continue; decimals += 1 }
      body += ch
    } else if (ch === '.' && !seenDot && opts.precision > 0) {
      seenDot = true
      body += body === '' ? '0.' : '.'
    }
  }
  return `${negative ? '-' : ''}${body}`
}

/** Number of decimal places a typed value carries ("1.50" gives 2). */
export function decimalsOf(text: string): number {
  const fraction = text.split('.')[1]
  return fraction ? fraction.length : 0
}

/** The text as a number, or null when it is empty or only a sign/point. */
export function numberOf(text: string): number | null {
  if (!/\d/.test(text)) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}
