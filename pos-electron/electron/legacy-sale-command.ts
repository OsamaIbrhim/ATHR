/**
 * Sales queued by a pre-W3 till carry `payment_method` and no `payments[]` or
 * `invoice_number`; the server no longer accepts that shape. The local
 * migration rewrites every unsent one into the current shape so no sale is
 * stranded by the upgrade (spec W3 §0: zero data loss).
 */

const LEGACY_METHOD: Record<string, string> = {
  cash: 'cash',
  card: 'card',
  instapay: 'bank_transfer',
  vodafone_cash: 'wallet',
  installment: 'other',
}

/** The server-side method a legacy method becomes; anything unknown is `other`. */
export function legacyPaymentMethod(method: unknown): string {
  return LEGACY_METHOD[String(method)] ?? 'other'
}

export interface LegacyOutboxSale {
  payload: string
  /** The number the till printed for this sale (`sales_local.invoice_number`). */
  printedNumber: string | null
}

/**
 * Returns the payload in the current shape, or null when it needs no change
 * (already current, or not JSON: an unreadable row is left for the sync to
 * quarantine, never rewritten).
 */
export function upgradeLegacySaleCommand({ payload, printedNumber }: LegacyOutboxSale): string | null {
  let command: Record<string, any>
  try {
    command = JSON.parse(payload)
  } catch {
    return null
  }
  if (!command || typeof command !== 'object' || Array.isArray(command.payments)) return null
  if (!('payment_method' in command)) return null
  const { payment_method, ...rest } = command
  const total = Number(rest.local_total)
  const upgraded: Record<string, any> = {
    ...rest,
    payments: [{ method: legacyPaymentMethod(payment_method), amount: Number.isFinite(total) ? total : 0 }],
  }
  if (printedNumber && !upgraded.invoice_number) upgraded.invoice_number = printedNumber
  return JSON.stringify(upgraded)
}
