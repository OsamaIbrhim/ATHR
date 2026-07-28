import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { PosCompatibilityError } from './pos-compatibility'
import {
  classifySyncError,
  outboxItemDueAt,
  retryDelayMs,
  stableRetryJitterMs,
} from './sync-policy'

describe('POS synchronization retry policy', () => {
  it('uses bounded exponential backoff', () => {
    expect(retryDelayMs(1)).toBe(15_000)
    expect(retryDelayMs(2)).toBe(30_000)
    expect(retryDelayMs(3)).toBe(60_000)
    expect(retryDelayMs(7)).toBe(15 * 60_000)
    expect(retryDelayMs(100)).toBe(15 * 60_000)
  })

  it('adds stable per-operation jitter to avoid a fleet retry spike', () => {
    const first = stableRetryJitterMs('sale-1', 3, 60_000)
    expect(first).toBe(stableRetryJitterMs('sale-1', 3, 60_000))
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(12_000)
    const decision = classifySyncError(
      new ApiError({ code: 'NETWORK_ERROR' }),
      3,
      0,
      'sale-1',
    )
    expect(Date.parse(String(decision.nextAttemptAt))).toBe(
      60_000 + first,
    )
  })

  it('honors a bounded server retry-after value', () => {
    expect(retryDelayMs(1, 2_000)).toBe(2_000)
    expect(retryDelayMs(1, 60 * 60_000)).toBe(15 * 60_000)
  })

  it('retries transient failures and blocks permanent failures', () => {
    expect(classifySyncError(
      new ApiError({ code: 'NETWORK_ERROR' }), 1, 0,
    )).toMatchObject({
      retryable: true,
      failureClass: 'network',
      nextAttemptAt: new Date(15_000).toISOString(),
    })
    expect(classifySyncError(new ApiError({}, 503)))
      .toMatchObject({ retryable: true, failureClass: 'server' })
    expect(classifySyncError(new ApiError({}, 403)))
      .toMatchObject({ retryable: false, failureClass: 'validation' })
    expect(classifySyncError(
      new ApiError({ code: 'TERMINAL_CREDENTIAL_INVALID' }, 401),
    )).toMatchObject({ retryable: false, failureClass: 'terminal' })
    expect(classifySyncError(new PosCompatibilityError(
      'POS_PROTOCOL_UNSUPPORTED',
      'blocked',
    ))).toMatchObject({
      retryable: false,
      failureClass: 'compatibility',
    })
  })

  it('never converts a temporary server outage into a lost sale', () => {
    expect(classifySyncError(
      new ApiError({ code: 'INTERNAL_ERROR' }, 500),
      100,
      0,
      'sale-stuck',
    )).toMatchObject({
      retryable: true,
      failureClass: 'server',
      blockedReason: null,
    })
  })

  it('derives the next attempt from persisted outbox attempt data', () => {
    const due = outboxItemDueAt({
      id: 'sale-1',
      attempt_count: 3,
      last_attempt_at: '2026-07-26T00:00:00.000Z',
    })
    expect(due).toBeGreaterThan(
      Date.parse('2026-07-26T00:01:00.000Z'),
    )
    expect(due).toBeLessThan(
      Date.parse('2026-07-26T00:01:12.001Z'),
    )
  })
})
