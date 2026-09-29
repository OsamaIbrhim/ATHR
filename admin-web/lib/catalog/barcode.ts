import type { BarcodeKind } from './types'

export const BARCODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
export const MAX_BARCODES_PER_VARIANT = 20
export const QUANTITY_SCALE = 3

/** Decimals a barcode's pack quantity may carry: the unit's precision, capped by the storage scale. */
export function packQtyDecimals(uomPrecision: number | undefined): number {
  return Math.min(uomPrecision ?? 0, QUANTITY_SCALE)
}

export const packQtyStep = (uomPrecision: number | undefined) =>
  packQtyDecimals(uomPrecision) === 0 ? '1' : `0.${'0'.repeat(packQtyDecimals(uomPrecision) - 1)}1`

/** True when `value` has no more than `decimals` decimal places. */
export function hasAtMostDecimals(value: string, decimals: number): boolean {
  const [whole, fraction, extra] = value.split('.')
  if (extra !== undefined || !/^[0-9]+$/.test(whole)) return false
  return fraction === undefined || (/^[0-9]+$/.test(fraction) && fraction.length <= decimals)
}

export type ParsedBarcode =
  | { ok: true; code: string; pack_qty: number; kind: BarcodeKind }
  | { ok: false; error: string }

export function parseBarcode(
  input: { code: string; pack_qty: string; kind: BarcodeKind },
  uomPrecision?: number,
): ParsedBarcode {
  const code = input.code.trim()
  if (!BARCODE_PATTERN.test(code)) {
    return { ok: false, error: `الباركود "${code}" غير صالح: حتى 64 حرفًا من الحروف الإنجليزية والأرقام و . _ - فقط.` }
  }
  const raw = input.pack_qty.trim() || '1'
  if (input.kind === 'scale_plu') {
    if (Number(raw) !== 1) return { ok: false, error: `باركود الميزان ${code} يجب أن تكون كمية العبوة فيه 1.` }
    return { ok: true, code, pack_qty: 1, kind: input.kind }
  }
  const decimals = packQtyDecimals(uomPrecision)
  if (!hasAtMostDecimals(raw, decimals) || Number(raw) <= 0) {
    return {
      ok: false,
      error: decimals === 0
        ? `كمية العبوة للباركود ${code} يجب أن تكون عددًا صحيحًا موجبًا.`
        : `كمية العبوة للباركود ${code} رقم موجب بحد أقصى ${decimals} منازل عشرية.`,
    }
  }
  return { ok: true, code, pack_qty: Number(raw), kind: input.kind }
}

/** Formats a quantity with the unit's precision (no trailing noise). */
export function formatQuantity(value: unknown, precision = 3): string {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toLocaleString('en-US', { maximumFractionDigits: Math.min(precision, QUANTITY_SCALE), useGrouping: false })
}
