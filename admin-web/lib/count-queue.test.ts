import { describe, expect, it, vi } from 'vitest'
import { ENTRY_ID_PATTERN, newEntryId, queueLabel, ScanQueue, type QueuedEntry, type ScanResult, type StorageLike } from './count-queue'

const memory = (): StorageLike & { data: Record<string, string> } => {
  const data: Record<string, string> = {}
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v }, removeItem: k => { delete data[k] } }
}
const ok = (entries: QueuedEntry[]): ScanResult[] => entries.map(e => ({ entry_id: e.entry_id, status: 'counted' }))
const networkError = () => Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' })

describe('newEntryId', () => {
  it('always satisfies the API pattern', () => {
    for (let i = 0; i < 20; i++) expect(newEntryId()).toMatch(ENTRY_ID_PATTERN)
  })
})

describe('ScanQueue', () => {
  it('sends in order, clears storage and reports results', async () => {
    const storage = memory()
    const onResults = vi.fn()
    const send = vi.fn(async (e: QueuedEntry[]) => ok(e))
    const q = new ScanQueue('k', storage, send, onResults)
    q.enqueue({ barcode: '111' }); q.enqueue({ barcode: '222' })
    expect(q.pending).toBe(2)
    expect(JSON.parse(storage.data.k)).toHaveLength(2)
    await q.flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].map(e => e.barcode)).toEqual(['111', '222'])
    expect(q.pending).toBe(0)
    expect(q.status).toBe('saved')
    expect(storage.data.k).toBeUndefined()
    expect(onResults).toHaveBeenCalledTimes(1)
  })

  it('keeps entries on a network failure and retries them with the same entry_id', async () => {
    const storage = memory()
    let failing = true
    const seen: string[][] = []
    const send = async (e: QueuedEntry[]) => { seen.push(e.map(x => x.entry_id)); if (failing) throw networkError(); return ok(e) }
    const q = new ScanQueue('k', storage, send)
    const id = q.enqueue({ barcode: '111' })
    await q.flush()
    expect(q.pending).toBe(1)
    expect(q.status).toBe('offline')
    expect(queueLabel(q.status, q.pending)).toBe('لا يوجد اتصال — 1 في الانتظار')
    failing = false
    await q.flush()
    expect(q.pending).toBe(0)
    expect(seen).toEqual([[id], [id]])
  })

  it('survives a reload: a new queue on the same storage resumes the pending entries', async () => {
    const storage = memory()
    const first = new ScanQueue('k', storage, async () => { throw networkError() })
    const id = first.enqueue({ variant_id: 'v', qty: 2, mode: 'set' })
    await first.flush()
    const send = vi.fn(async (e: QueuedEntry[]) => ok(e))
    const second = new ScanQueue('k', storage, send)
    expect(second.pending).toBe(1)
    await second.flush()
    expect(send.mock.calls[0][0][0]).toMatchObject({ entry_id: id, mode: 'set', qty: 2 })
    expect(second.pending).toBe(0)
  })

  it('splits batches of more than 100', async () => {
    const send = vi.fn(async (e: QueuedEntry[]) => ok(e))
    const q = new ScanQueue('k', memory(), send)
    for (let i = 0; i < 230; i++) q.enqueue({ barcode: String(i) })
    await q.flush()
    expect(send.mock.calls.map(c => c[0].length)).toEqual([100, 100, 30])
  })

  it('drops entries the server refuses for good, so the queue cannot jam', async () => {
    const onResults = vi.fn()
    const send = vi.fn(async () => { throw Object.assign(new Error('bad'), { code: 'VALIDATION_FAILED' }) })
    const q = new ScanQueue('k', memory(), send, onResults)
    q.enqueue({ barcode: '1' })
    await q.flush()
    expect(q.pending).toBe(0)
    expect(onResults.mock.calls[0][0][0]).toMatchObject({ status: 'rejected' })
  })

  it('stops and keeps the scans when the count was closed', async () => {
    const send = vi.fn(async () => { throw Object.assign(new Error('closed'), { code: 'STOCK_COUNT_CLOSED' }) })
    const q = new ScanQueue('k', memory(), send)
    q.enqueue({ barcode: '1' })
    await q.flush()
    expect(q.closedReason).toBe('STOCK_COUNT_CLOSED')
    expect(q.pending).toBe(1)
    await q.flush()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('labels the states', () => {
    expect(queueLabel('saved', 0)).toBe('تم الحفظ')
    expect(queueLabel('sending', 3)).toBe('جارٍ الإرسال (3)')
  })
})
