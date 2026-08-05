import { describe, expect, it } from 'vitest'
import { reconcileDeviceTenantId } from './device-tenant-migration'

const ENROLLED_BEFORE_PHASE_C = {
  device_id: 'device-1',
  device_token: 'token-1',
  branch_id: 'branch-1',
  terminal_id: 'terminal-1',
  terminal_code: 'POS-1',
  // no tenant_id — this is what every production install looks like today.
}

describe('WP-007 Phase C — POS local tenant self-heal', () => {
  it('learns its tenant from the next heartbeat with zero re-enrollment', () => {
    const migrated = reconcileDeviceTenantId(ENROLLED_BEFORE_PHASE_C, {
      id: 'terminal-1',
      tenant_id: 'tenant-a',
    })

    expect(migrated).toEqual({ ...ENROLLED_BEFORE_PHASE_C, tenant_id: 'tenant-a' })
    // The device keeps every other credential untouched — enrollment itself
    // never happens again.
    expect(migrated?.device_token).toBe('token-1')
  })

  it('does not adopt a tenant_id from a heartbeat naming a different terminal', () => {
    const migrated = reconcileDeviceTenantId(ENROLLED_BEFORE_PHASE_C, {
      id: 'some-other-terminal',
      tenant_id: 'tenant-a',
    })

    expect(migrated).toEqual(ENROLLED_BEFORE_PHASE_C)
  })

  it('does not blank out an already-known tenant_id when a response omits it', () => {
    const alreadyMigrated = { ...ENROLLED_BEFORE_PHASE_C, tenant_id: 'tenant-a' }
    const migrated = reconcileDeviceTenantId(alreadyMigrated, {
      id: 'terminal-1',
      tenant_id: undefined,
    })

    expect(migrated).toEqual(alreadyMigrated)
  })

  it('is a no-op once the tenant_id already matches', () => {
    const alreadyMigrated = { ...ENROLLED_BEFORE_PHASE_C, tenant_id: 'tenant-a' }
    const migrated = reconcileDeviceTenantId(alreadyMigrated, {
      id: 'terminal-1',
      tenant_id: 'tenant-a',
    })

    expect(migrated).toBe(alreadyMigrated)
  })

  it('leaves an unenrolled device untouched', () => {
    expect(reconcileDeviceTenantId(null, { id: 'terminal-1', tenant_id: 'tenant-a' })).toBeNull()
    expect(reconcileDeviceTenantId(undefined, { id: 'terminal-1', tenant_id: 'tenant-a' })).toBeNull()
  })
})
