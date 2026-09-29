/** A position in the server's change stream: "txid:sequence", both unbounded integers. */
type Cursor = readonly [txid: bigint, sequence: bigint]

function parseCursor(text: string | null): Cursor | null {
  const match = /^(\d{1,20}):(\d{1,19})$/.exec(text ?? '')
  return match ? [BigInt(match[1]), BigInt(match[2])] : null
}

/** Compares as a (txid, sequence) pair, never as text or Number. */
function compareCursors(left: Cursor, right: Cursor) {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1
  if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1
  return 0
}

export type CursorTransition =
  | { kind: 'delta'; hasMore: boolean }
  // The first page of a snapshot; `current` is the cursor we had (null on a fresh till).
  | { kind: 'snapshot-first' }
  // A later page: the server must repeat the cursor the snapshot started at.
  | { kind: 'snapshot-next' }

/**
 * Whether the cursor a response carries may follow the one we sent. A delta
 * must move forward (equal only when it is the last page and nothing changed);
 * every page of one snapshot repeats the same cursor.
 */
export function cursorTransitionIsValid(
  current: string | null,
  next: string | null,
  transition: CursorTransition,
) {
  const nextValue = parseCursor(next)
  if (!nextValue) return false
  if (transition.kind === 'snapshot-first' && current === null) return true
  const currentValue = parseCursor(current)
  if (!currentValue) return false
  const order = compareCursors(nextValue, currentValue)
  if (transition.kind === 'snapshot-next') return order === 0
  if (transition.kind === 'snapshot-first') return order >= 0
  return transition.hasMore ? order > 0 : order >= 0
}
