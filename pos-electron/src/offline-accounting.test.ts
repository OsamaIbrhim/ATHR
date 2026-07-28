import { describe, expect, it } from 'vitest'
import {
  isValidOfflineAccountingContext,
  isValidOfflineAccountingSummary,
  maxTerminalSequence,
  nextTerminalSequence,
  offlineAccountingContextMatches,
  offlineAccountingSummaryMatches,
  parseTerminalSequence,
  toOfflineAccountingSummary,
} from '../electron/offline-accounting'

const now = Date.parse('2026-07-22T10:00:00.000Z')
const context = {
  context_version: 2 as const,
  session_id: 'session-1',
  user_id: 'user-1',
  role: 'cashier' as const,
  branch_id: 'branch-1',
  terminal_id: 'terminal-1',
  shift_id: 'shift-1',
  issued_at: '2026-07-22T09:00:00.000Z',
  expires_at: '2026-07-22T11:00:00.000Z',
  server_last_sale_sequence: '8',
}

const expected = {
  session: {
    user: {
      id: 'user-1',
      name: 'Cashier',
      role: 'cashier' as const,
      branch_id: 'branch-1',
    },
  },
  device: {
    branch_id: 'branch-1',
    terminal_id: 'terminal-1',
  },
  shift: {
    id: 'shift-1',
    branch_id: 'branch-1',
  },
}

describe('offline accounting context', () => {
  it('accepts a live context matching the user, terminal and shift', () => {
    expect(isValidOfflineAccountingContext(context, now)).toBe(true)
    expect(offlineAccountingContextMatches(context, expected, now)).toBe(true)
    expect(
      offlineAccountingContextMatches(
        context,
        { ...expected, shift: { id: 'shift-2', branch_id: 'branch-1' } },
        now,
      ),
    ).toBe(false)
  })

  it('keeps a prepared shift usable offline even after its advisory refresh time', () => {
    expect(
      isValidOfflineAccountingContext(context, Date.parse(context.expires_at)),
    ).toBe(true)
    expect(
      offlineAccountingContextMatches(
        context,
        expected,
        Date.parse('2027-07-22T10:00:00.000Z'),
      ),
    ).toBe(true)
  })

  it('rejects malformed context data without depending on a server key', () => {
    expect(
      isValidOfflineAccountingContext(
        { ...context, context_version: 1 },
        now,
      ),
    ).toBe(false)
    expect(
      isValidOfflineAccountingContext(
        { ...context, expires_at: 'not-a-date' },
        now,
      ),
    ).toBe(false)
  })

  it('exposes a non-secret authorization summary to the renderer', () => {
    const summary = toOfflineAccountingSummary(context)
    expect(summary).not.toHaveProperty('token')
    expect(summary).not.toHaveProperty('key_id')
    expect(summary.authorized).toBe(true)
    expect(
      isValidOfflineAccountingSummary(summary, now),
    ).toBe(true)
    expect(
      offlineAccountingSummaryMatches(
        summary,
        expected,
        now,
      ),
    ).toBe(true)
  })

  it('uses exact decimal bigint sequencing without JavaScript number precision loss', () => {
    expect(parseTerminalSequence('9007199254740993')).toBe(9007199254740993n)
    expect(maxTerminalSequence('8', '10', '9')).toBe('10')
    expect(nextTerminalSequence('9007199254740993')).toBe('9007199254740994')
    expect(() => parseTerminalSequence('-1')).toThrow()
    expect(() => parseTerminalSequence('1.5')).toThrow()
  })
})
