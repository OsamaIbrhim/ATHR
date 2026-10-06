'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from './api'
import { bumpLocal, applyResults, emptyCounterState, UNDO_WINDOW_MS, type CounterState, type MineRow, type VariantLite } from './counts'
import { ScanQueue, queueLabel, type QueueStatus } from './count-queue'

/**
 * The counting session of one person on one count: local counters, the offline
 * scan queue (kept in localStorage), and the "undo last scan" window.
 */
export function useCounter(countId: string, enabled: boolean) {
  const [state, setState] = useState<CounterState>(emptyCounterState())
  const [status, setStatus] = useState<QueueStatus>('saved')
  const [pending, setPending] = useState(0)
  const [closed, setClosed] = useState(false)
  const [undo, setUndo] = useState<{ variant: VariantLite; added: number; until: number } | null>(null)
  const queue = useRef<ScanQueue | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const refresh = useCallback(async () => {
    try {
      const recent = await apiGet(`/inventory/counts/${countId}/recent?page=1&page_size=100`)
      setState(cur => {
        const mine = new Map<string, MineRow>()
        for (const row of recent.items ?? []) mine.set(row.variant.id, { variant: row.variant, mine: row.counted_by_me, total: row.counted_total, lastAt: Date.parse(row.last_counted_at) || 0 })
        return { ...cur, mine }
      })
    } catch { /* the list is a convenience; scans still work */ }
  }, [countId])

  useEffect(() => {
    if (!enabled) return
    const q = new ScanQueue(
      `athr.count.queue.${countId}`,
      typeof window === 'undefined' ? null : window.localStorage,
      async entries => (await apiPost(`/inventory/counts/${countId}/entries`, { entries })).results,
      results => {
        setState(cur => applyResults(cur, results, Date.now()))
        const hit = (results as any[]).find(r => r.status === 'counted' && r.variant)
        if (hit) setUndo({ variant: hit.variant, added: Number(hit.added), until: Date.now() + UNDO_WINDOW_MS })
      },
    )
    queue.current = q
    const sync = () => { setStatus(q.status); setPending(q.pending); if (q.closedReason) setClosed(true) }
    const off = q.subscribe(sync)
    sync()
    void refresh().then(() => q.flush())
    const online = () => { void q.flush() }
    window.addEventListener('online', online)
    const timer = setInterval(() => { if (q.pending) void q.flush() }, 8000)
    return () => { off(); window.removeEventListener('online', online); clearInterval(timer) }
  }, [countId, enabled, refresh])

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), Math.max(0, undo.until - Date.now()))
    return () => clearTimeout(timer)
  }, [undo])

  const send = useCallback(() => { void queue.current?.flush() }, [])
  /** A scanner code or typed barcode; the server resolves it. */
  const scanBarcode = useCallback((barcode: string) => { queue.current?.enqueue({ barcode, qty: 1, mode: 'add' }); send() }, [send])
  const change = useCallback((variant: VariantLite, opts: { add?: number; set?: number }) => {
    setState(cur => bumpLocal(cur, variant, opts, Date.now()))
    queue.current?.enqueue({ variant_id: variant.id, qty: opts.set ?? opts.add ?? 1, mode: opts.set !== undefined ? 'set' : 'add' })
    setUndo(null); send()
  }, [send])
  const undoLast = useCallback(() => {
    if (!undo) return
    const { variant, added } = undo
    setUndo(null)
    setState(cur => bumpLocal(cur, variant, { add: -added }, Date.now()))
    queue.current?.enqueue({ variant_id: variant.id, qty: -added, mode: 'add' }); send()
  }, [undo, send])
  const allowOutOfScope = useCallback((variantId: string) => { queue.current?.enqueue({ variant_id: variantId, qty: 1, mode: 'add', allow_out_of_scope: true }); send() }, [send])
  const dismissLast = useCallback(() => setState(cur => ({ ...cur, last: null })), [])

  const rows = useMemo(() => [...state.mine.values()].sort((a, b) => b.lastAt - a.lastAt), [state.mine])
  const units = rows.reduce((sum, r) => sum + r.mine, 0)
  return { state, rows, units, status, pending, label: queueLabel(status, pending), closed, undo, scanBarcode, change, undoLast, allowOutOfScope, dismissLast, flush: send }
}
