import { configureAutoUpdates } from './auto-update'
import { pendingOutboxCount } from './db/catalog'
import { getConfiguredApiBase } from './deployment-config'
import { getWindow } from './window'

let configured = false

/** Idempotent: starts auto-updates once an API base is known. */
export function ensureAutoUpdates() {
  const apiBase = getConfiguredApiBase()
  if (configured || !apiBase) return
  configured = true
  configureAutoUpdates({
    manifestUrl: `${apiBase}/pos-updates/latest`,
    window: getWindow,
    pendingOutboxCount,
  })
}
