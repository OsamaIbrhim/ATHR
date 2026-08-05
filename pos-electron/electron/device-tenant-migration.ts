export type EnrolledDevice = {
  device_id: string
  device_token: string
  branch_id: string
  terminal_id: string
  terminal_code: string
  tenant_id?: string
}

/**
 * WP-007 Phase C: existing production POS installs were enrolled before this
 * release and carry no `tenant_id` in their encrypted local device state —
 * Phase B only backfilled the database column, which this terminal's local
 * copy never saw. Rather than forcing a re-enrollment, the device learns its
 * own tenant from the next `/terminals/heartbeat` response it already sends
 * periodically, and persists it locally.
 *
 * Only applied when the heartbeat's terminal id still matches the locally
 * enrolled device (defense in depth against a stale/misdirected response),
 * and never used to blank out an already-known tenant_id.
 */
export function reconcileDeviceTenantId(
  device: EnrolledDevice | null | undefined,
  heartbeatTerminal: { id?: unknown; tenant_id?: unknown } | null | undefined,
): EnrolledDevice | null {
  if (!device) return device ?? null

  const tenantId = typeof heartbeatTerminal?.tenant_id === 'string' ? heartbeatTerminal.tenant_id : ''
  const terminalId = typeof heartbeatTerminal?.id === 'string' ? heartbeatTerminal.id : ''

  if (!tenantId || terminalId !== device.terminal_id || tenantId === device.tenant_id) {
    return device
  }

  return { ...device, tenant_id: tenantId }
}
