import { safeStorage } from 'electron'
import * as fs from 'fs'
import type { OfflineAccountingContext } from './offline-accounting'
import type { OfflineLoginVerifier } from './offline-login'
import { sanitizeBootstrapState } from './secure-public'
import { secureStatePath } from './paths'

export type AuthenticatedSession = {
  access_token: string
  refresh_token: string
  user: {
    id: string
    name: string
    role: 'branch_manager' | 'cashier'
    branch_id: string
  }
}

export type PersistedAuth = {
  session: AuthenticatedSession
  offline_valid_until: string
}

export type SecureState = {
  auth?: PersistedAuth
  device?: {
    device_id: string
    device_token: string
    branch_id: string
    terminal_id: string
    terminal_code: string
    // WP-007 Phase C: optional so a terminal enrolled before this release
    // (local state predating this field) keeps working without
    // re-enrollment — see `reconcileDeviceTenantId`.
    tenant_id?: string
  }
  accounting?: OfflineAccountingContext
  offline_login?: OfflineLoginVerifier
}

/**
 * The decrypted JSON, kept in main-process memory after the first successful
 * decrypt so a sale does not pay for a safeStorage (DPAPI) call. Only the
 * string is cached and every read parses a fresh object, so a caller that
 * mutates its copy and then fails cannot corrupt the cache. It is replaced on
 * every write and dropped by `invalidateSecureState` (logout, factory reset).
 */
let cachedJson: string | null = null

export function invalidateSecureState() {
  cachedJson = null
}

export function readSecureState(): SecureState {
  try {
    if (cachedJson !== null) return JSON.parse(cachedJson)
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(secureStatePath())) return {}
    const json = safeStorage.decryptString(fs.readFileSync(secureStatePath()))
    const state = JSON.parse(json)
    cachedJson = json
    return state
  } catch {
    return {}
  }
}

export function writeSecureState(state: SecureState) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable on this computer')
  }
  const json = JSON.stringify(state)
  const encrypted = safeStorage.encryptString(json)
  const target = secureStatePath()
  const temporary = `${target}.tmp`
  cachedJson = null
  fs.writeFileSync(temporary, encrypted, { mode: 0o600 })
  fs.renameSync(temporary, target)
  cachedJson = json
}

export function publicBootstrapState() {
  // Every application start must require a cashier login. Existing secure
  // credentials remain available only to the main process for validated
  // online refresh or offline password verification.
  return sanitizeBootstrapState(readSecureState())
}

export function saveAuthenticatedSession(session: AuthenticatedSession) {
  const state = readSecureState()
  state.auth = {
    session,
    offline_valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }
  writeSecureState(state)
}

export function clearSessionState() {
  const state = readSecureState()
  delete state.auth
  delete state.accounting
  delete state.offline_login
  writeSecureState(state)
}

export function clearDeviceState() {
  const state = readSecureState()
  delete state.device
  delete state.auth
  delete state.accounting
  delete state.offline_login
  writeSecureState(state)
}
