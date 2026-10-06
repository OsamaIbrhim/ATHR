/**
 * Offline-safe queue of count scans. Every scan gets a client `entry_id` before it
 * is sent, so retrying a batch that may or may not have arrived is harmless (the
 * backend ignores an entry_id it has already recorded). The queue survives a
 * reload through `storage`.
 */

export interface QueuedEntry {
  entry_id: string
  barcode?: string
  variant_id?: string
  qty?: number
  mode?: 'add' | 'set'
  allow_out_of_scope?: boolean
}

export interface ScanResult {
  entry_id: string
  status: string
  message_ar?: string
  [key: string]: unknown
}

export type QueueStatus = 'saved' | 'sending' | 'offline'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const MAX_BATCH = 100

/** 8-100 chars of [A-Za-z0-9._:-], as the API requires. */
export function newEntryId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `e-${random}`
}

export const ENTRY_ID_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/

/** A send that failed because of the network or a server fault (worth retrying), not because the entries are wrong. */
export const isRetryable = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code
  return code === 'NETWORK_ERROR' || code === 'REQUEST_FAILED' || code === undefined
}

export class ScanQueue {
  private entries: QueuedEntry[] = []
  private sending = false
  status: QueueStatus = 'saved'
  closedReason: string | null = null
  private listeners = new Set<() => void>()

  constructor(
    private key: string,
    private storage: StorageLike | null,
    private send: (entries: QueuedEntry[]) => Promise<ScanResult[]>,
    private onResults: (results: ScanResult[]) => void = () => {},
  ) {
    try {
      const raw = storage?.getItem(key)
      const parsed = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) this.entries = parsed.filter(e => e && ENTRY_ID_PATTERN.test(e.entry_id))
    } catch { this.entries = [] }
    if (this.entries.length) this.status = 'offline'
  }

  get pending(): number { return this.entries.length }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { this.listeners.forEach(listener => listener()) }
  private persist() {
    try {
      if (this.entries.length) this.storage?.setItem(this.key, JSON.stringify(this.entries))
      else this.storage?.removeItem(this.key)
    } catch { /* storage full or blocked: the queue still works in memory */ }
  }

  /** Queues an entry (assigning an id when missing) and returns its id. */
  enqueue(entry: Omit<QueuedEntry, 'entry_id'> & { entry_id?: string }): string {
    const entry_id = entry.entry_id ?? newEntryId()
    this.entries.push({ ...entry, entry_id })
    this.persist(); this.emit()
    return entry_id
  }

  /** Sends everything waiting, batch by batch. Stops at the first retryable failure. Never throws. */
  async flush(): Promise<void> {
    if (this.sending || this.closedReason) return
    this.sending = true
    this.status = this.entries.length ? 'sending' : 'saved'
    this.emit()
    try {
      while (this.entries.length) {
        const batch = this.entries.slice(0, MAX_BATCH)
        let results: ScanResult[]
        try {
          results = await this.send(batch)
        } catch (error) {
          const code = (error as { code?: string } | null)?.code
          if (code === 'STOCK_COUNT_CLOSED') { this.closedReason = code; this.status = 'offline'; return }
          if (isRetryable(error)) { this.status = 'offline'; return }
          // The server refused these entries for good (validation): drop them so the queue cannot jam.
          this.entries = this.entries.slice(batch.length)
          this.persist()
          this.onResults(batch.map(entry => ({ entry_id: entry.entry_id, status: 'rejected', message_ar: (error as Error)?.message })))
          continue
        }
        const done = new Set(batch.map(entry => entry.entry_id))
        this.entries = this.entries.filter(entry => !done.has(entry.entry_id))
        this.persist()
        this.onResults(results)
      }
      this.status = 'saved'
    } finally {
      this.sending = false
      if (this.status === 'sending') this.status = this.entries.length ? 'offline' : 'saved'
      this.emit()
    }
  }
}

/** The chip text: "تم الحفظ" / "جارٍ الإرسال (n)" / "لا يوجد اتصال — n في الانتظار". */
export function queueLabel(status: QueueStatus, pending: number): string {
  if (status === 'sending') return `جارٍ الإرسال (${pending})`
  if (status === 'offline' && pending > 0) return `لا يوجد اتصال — ${pending} في الانتظار`
  return 'تم الحفظ'
}
