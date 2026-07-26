import { describe, expect, it } from 'vitest'
import {
  assertFactoryResetAllowed,
  FactoryResetPolicyError,
  factoryResetStatus,
} from '../electron/factory-reset-policy'

const ready = {
  role: 'branch_manager',
  terminalCode: 'POS-93DE7EB8',
  pendingCount: 0,
  heldCount: 0,
  syncStatus: 'success',
}

describe('safe POS factory reset policy', () => {
  it('allows only a manager with exact terminal confirmation and empty queues', () => {
    expect(
      assertFactoryResetAllowed(ready, 'pos-93de7eb8'),
    ).toMatchObject({
      can_reset: true,
      terminal_code: 'POS-93DE7EB8',
    })
  })

  it('blocks cashiers even when the device has no local work', () => {
    expect(() =>
      assertFactoryResetAllowed(
        { ...ready, role: 'cashier' },
        ready.terminalCode,
      ),
    ).toThrowError(FactoryResetPolicyError)
  })

  it('reports pending operations and held invoices as blockers', () => {
    expect(factoryResetStatus({
      ...ready,
      pendingCount: 2,
      heldCount: 1,
    })).toMatchObject({
      can_reset: false,
      pending_count: 2,
      held_count: 1,
    })
  })

  it('blocks reset while synchronization is running', () => {
    expect(() =>
      assertFactoryResetAllowed(
        { ...ready, syncStatus: 'syncing' },
        ready.terminalCode,
      ),
    ).toThrow('تنتهي المزامنة')
  })

  it('rejects a terminal code mismatch', () => {
    expect(() =>
      assertFactoryResetAllowed(ready, 'POS-WRONG000'),
    ).toThrow('لا يطابق الجهاز الحالي')
  })
})
