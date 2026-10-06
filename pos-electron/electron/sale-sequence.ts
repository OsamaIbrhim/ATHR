import { getMeta, setMeta } from './db/queries'
import {
  isValidOfflineAccountingContext,
  isTerminalSequence,
  maxTerminalSequence,
  type OfflineAccountingContext,
} from './offline-accounting'
import { readSecureState, writeSecureState } from './secure-state'

export function alignLocalSequence(context?: OfflineAccountingContext | null) {
  if (!context || !isValidOfflineAccountingContext(context)) return
  setMeta(
    'terminal_sale_sequence',
    maxTerminalSequence(
      getMeta('terminal_sale_sequence'),
      context.server_last_sale_sequence,
    ),
  )
}

export function updateSecureAcknowledgedSequence(sequence: string) {
  try {
    const state = readSecureState()
    if (!state.accounting || !isValidOfflineAccountingContext(state.accounting)) {
      return
    }
    state.accounting.server_last_sale_sequence = maxTerminalSequence(
      state.accounting.server_last_sale_sequence,
      sequence,
    )
    writeSecureState(state)
  } catch {
    // The SQLite sequence remains authoritative for this installation. The
    // secure copy is updated on a best-effort basis to help recovery after a
    // local database restore.
  }
}

/**
 * A re-enrolled till continues its numbering after the last sale the server
 * accepted for this terminal (`terminal.last_sale_sequence` from enroll), so a
 * wiped device never prints a number it already used. Never lowers the counter.
 */
export function seedSequenceFromEnrollment(lastSaleSequence: unknown) {
  if (!isTerminalSequence(lastSaleSequence)) return
  setMeta(
    'terminal_sale_sequence',
    maxTerminalSequence(getMeta('terminal_sale_sequence'), lastSaleSequence),
  )
}
