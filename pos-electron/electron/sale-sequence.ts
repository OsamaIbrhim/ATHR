import { getMeta, setMeta } from './db/queries'
import {
  isValidOfflineAccountingContext,
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
