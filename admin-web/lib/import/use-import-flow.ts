'use client'
import { useCallback, useRef, useState } from 'react'
import { apiPost } from '../api'
import { planChunks, type DuplicateRegistry } from './chunking'
import { dryRunAll, importChunks, precheckDuplicates, type ChunkResponse, type ImportOutcome, type RowResult, type Tally } from './runner'
import type { ImportRow } from './rows'

export type Phase = 'idle' | 'checking' | 'checked' | 'importing' | 'done'
const EMPTY: Tally = { created: 0, skipped: 0, failed: 0, openingQuantities: 0, categoriesCreated: 0 }
const post = (request: unknown): Promise<ChunkResponse> => apiPost('/products/import', request)

/** Dry run and import of one file, chunk by chunk, with stop and resume. */
export function useImportFlow(priceTaxMode: 'inclusive' | 'exclusive', branchId: string | undefined) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [checkError, setCheckError] = useState('')
  const [results, setResults] = useState<RowResult[]>([])
  const [planLimit, setPlanLimit] = useState<ChunkResponse['plan_limit'] | null>(null)
  const [tally, setTally] = useState<Tally>(EMPTY)
  const [runResults, setRunResults] = useState<Map<number, RowResult>>(new Map())
  const [runError, setRunError] = useState<{ chunk: number; message: string } | null>(null)
  const [stopped, setStopped] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const pending = useRef<ImportRow[][]>([])
  const outcome = useRef<ImportOutcome | null>(null)
  const stopFlag = useRef(false)
  const readyRows = useRef<ImportRow[]>([])
  const token = useRef(0)

  const check = useCallback(async (rows: ImportRow[], registry: DuplicateRegistry, label: string) => {
    const mine = ++token.current
    setPhase('checking'); setCheckError(''); setResults([]); setPlanLimit(null); setProgress({ done: 0, total: rows.length })
    try {
      const { send, rejected } = precheckDuplicates(rows, registry, label)
      const out = await dryRunAll({ rows: send, rejected, post, priceTaxMode, branchId, onProgress: (done) => { if (mine === token.current) setProgress({ done, total: rows.length }) } })
      if (mine !== token.current) return
      setResults(out.results); setPlanLimit(out.planLimit)
      const byRef = new Map(rows.map(r => [r.row_ref, r]))
      readyRows.current = out.results.filter(r => r.status === 'ready').map(r => byRef.get(r.row_ref)!).filter(Boolean)
      setPhase('checked')
    } catch (e: any) {
      if (mine === token.current) { setCheckError(e.message || 'تعذر فحص الملف.'); setPhase('idle') }
    }
  }, [priceTaxMode, branchId])

  const drive = useCallback(async (chunks: ImportRow[][], total: number, prior?: ImportOutcome) => {
    stopFlag.current = false; setStopped(false); setRunError(null); setPhase('importing')
    const out = await importChunks({
      chunks, total, post, priceTaxMode, branchId, shouldStop: () => stopFlag.current,
      results: prior?.results, tally: prior?.tally, startAt: prior ? total - chunks.reduce((n, c) => n + c.length, 0) : 0,
      onProgress: (done, all, t) => { setProgress({ done, total: all }); setTally({ ...t }) },
    })
    outcome.current = out; pending.current = out.pending
    setRunResults(new Map(out.results)); setTally({ ...out.tally })
    setStopped(out.stopped); setRunError(out.error ?? null)
    setPhase(out.pending.length ? 'importing' : 'done')
  }, [priceTaxMode, branchId])

  const run = useCallback(async () => {
    const chunks = planChunks(readyRows.current)
    setStartedAt(Date.now()); setTally(EMPTY); setRunResults(new Map()); outcome.current = null
    setProgress({ done: 0, total: readyRows.current.length })
    await drive(chunks, readyRows.current.length)
  }, [drive])
  const resume = useCallback(async () => { await drive(pending.current, readyRows.current.length, outcome.current ?? undefined) }, [drive])
  const finish = useCallback(() => { pending.current = []; setPhase('done') }, [])
  const stop = useCallback(() => { stopFlag.current = true }, [])
  const reset = useCallback(() => { token.current += 1; setPhase('idle'); setResults([]); setRunResults(new Map()); setTally(EMPTY); setRunError(null); setStopped(false); pending.current = []; outcome.current = null }, [])

  return { phase, progress, checkError, results, planLimit, tally, runResults, runError, stopped, startedAt, readyCount: () => readyRows.current.length, check, run, resume, stop, finish, reset }
}
