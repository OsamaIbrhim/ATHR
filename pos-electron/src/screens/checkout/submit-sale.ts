import { api } from '../../api'
import { athr } from '../../electron'
import type { ExchangeStart } from '../../exchange'

type Payload = ReturnType<typeof import('./sale-payload').buildSalePayload>

export interface SavedSale {
  sync_id: string
  invoice_number: string
  occurred_at: string
  /** Set for an exchange: the number of the return recorded with it. */
  return_number?: string
}

/** A normal sale: stored on the till (stock, sale row and outbox in one transaction), uploaded by the next sync. */
export async function saveLocalSale(payload: Payload): Promise<SavedSale> {
  return athr.sale(payload)
}

/**
 * The sale half of an exchange. The main process numbers it and builds the
 * command once; `prepared` keeps it so a retry after a network failure sends
 * the very same command and the server answers with the same pair (no double
 * sale, no double return).
 */
export interface PreparedExchange {
  command: unknown
  invoice_number: string
  occurred_at: string
  sync_id: string
}

export async function submitExchange(
  payload: Payload,
  start: ExchangeStart,
  prepared: PreparedExchange | null,
): Promise<{ saved: SavedSale; prepared: PreparedExchange }> {
  const ready: PreparedExchange =
    prepared ??
    (await athr.prepare_exchange_sale(payload).then((value) => ({
      command: value.command,
      invoice_number: value.invoice_number,
      occurred_at: value.occurred_at,
      sync_id: payload.sync_id,
    })))
  const result = await api.exchangeSale({
    original_invoice_id: start.original_invoice_id,
    items: start.items,
    reason: start.reason,
    refund_method: start.refund_method,
    sale: ready.command,
  })
  return {
    prepared: ready,
    saved: {
      sync_id: ready.sync_id,
      invoice_number: ready.invoice_number,
      occurred_at: ready.occurred_at,
      return_number: result?.return?.return_invoice_number,
    },
  }
}
