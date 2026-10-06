import { POS_PROTOCOL_VERSION } from '../pos-protocol'
import { authenticatedFetch, envelope } from '../api-client'
import { closeDb } from '../db/connection'
import { getMeta, q } from '../db/queries'
import { getConfiguredApiBase } from '../deployment-config'
import { registerDiagnosticsIpc } from '../diagnostics-runtime'
import { registerFactoryResetIpc } from '../factory-reset-runtime'
import { openLocalDatabase } from '../db-startup'
import { dbPath, secureStatePath } from '../paths'
import { invalidateSecureState, readSecureState } from '../secure-state'
import { registerApiIpc } from './api'
import { registerAuthIpc } from './auth'
import { registerCatalogIpc } from './catalog'
import { registerHeldSalesIpc } from './held-sales'
import { registerPrintingIpc } from './printing'
import { registerSalesIpc } from './sales'
import { registerSettingsIpc } from './settings'
import { registerSyncIpc } from './sync'

/** Registers every renderer-facing IPC handler. The database must be open. */
export function registerAllIpc() {
  registerApiIpc()
  registerAuthIpc()
  registerCatalogIpc()
  registerSalesIpc()
  registerSettingsIpc()
  registerHeldSalesIpc()
  registerSyncIpc()
  registerPrintingIpc()
  registerDiagnosticsIpc({
    apiBase: () => getConfiguredApiBase() || '',
    protocolVersion: POS_PROTOCOL_VERSION,
    dbPath,
    getSecureState: readSecureState,
    getMeta,
    query: q,
  })
  registerFactoryResetIpc({
    dbPath,
    secureStatePath,
    getSecureState: readSecureState,
    query: q,
    getMeta,
    closeDb,
    reopenDb: openLocalDatabase,
    invalidateSecureState,
    decommission: (payload) =>
      authenticatedFetch('/terminals/self-decommission', {
        method: 'POST',
        body: payload,
      }),
    envelope,
  })
}
