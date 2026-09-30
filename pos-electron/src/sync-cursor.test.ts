import { describe, expect, it } from 'vitest'
import { cursorTransitionIsValid } from './sync-cursor'

describe('sync cursor transitions', () => {
  it('compares txid:sequence as a BigInt pair, not as text or Number', () => {
    // As text "9:1" > "10:1"; as Number 2^53+1 collapses onto 2^53.
    expect(cursorTransitionIsValid('9:1', '10:1', { kind: 'delta', hasMore: true })).toBe(true)
    expect(cursorTransitionIsValid('10:1', '9:1', { kind: 'delta', hasMore: false })).toBe(false)
    expect(
      cursorTransitionIsValid('9007199254740992:1', '9007199254740993:1', { kind: 'delta', hasMore: true }),
    ).toBe(true)
    expect(cursorTransitionIsValid('5:9', '5:10', { kind: 'delta', hasMore: true })).toBe(true)
    expect(cursorTransitionIsValid('5:10', '5:9', { kind: 'delta', hasMore: false })).toBe(false)
  })

  it('only a final delta page may repeat the cursor', () => {
    expect(cursorTransitionIsValid('5:1', '5:1', { kind: 'delta', hasMore: false })).toBe(true)
    expect(cursorTransitionIsValid('5:1', '5:1', { kind: 'delta', hasMore: true })).toBe(false)
  })

  it('a snapshot repeats one cursor across all its pages', () => {
    expect(cursorTransitionIsValid(null, '7:3', { kind: 'snapshot-first' })).toBe(true)
    expect(cursorTransitionIsValid('7:3', '7:3', { kind: 'snapshot-next' })).toBe(true)
    expect(cursorTransitionIsValid('7:3', '7:4', { kind: 'snapshot-next' })).toBe(false)
    expect(cursorTransitionIsValid('7:3', '7:2', { kind: 'snapshot-next' })).toBe(false)
  })

  it('a delta turned into a snapshot may not start behind our cursor', () => {
    expect(cursorTransitionIsValid('7:3', '7:3', { kind: 'snapshot-first' })).toBe(true)
    expect(cursorTransitionIsValid('7:3', '9:1', { kind: 'snapshot-first' })).toBe(true)
    expect(cursorTransitionIsValid('7:3', '7:2', { kind: 'snapshot-first' })).toBe(false)
  })

  it('rejects malformed cursors', () => {
    for (const bad of [null, '', '12', '1:', ':1', '1:2:3', 'a:b', '-1:2']) {
      expect(cursorTransitionIsValid('1:1', bad, { kind: 'delta', hasMore: false })).toBe(false)
    }
    expect(cursorTransitionIsValid('12', '13:1', { kind: 'delta', hasMore: false })).toBe(false)
  })
})
