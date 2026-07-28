import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import {
  isRetryableSyncError,
  performSync,
  SyncIntegrityError,
} from './sync'

const status = {
  device_id: 'device',
  terminal_name: 'POS',
  app_version: '1.4.0',
  sync_status: 'never',
  last_sync_at: null,
  last_error: null,
  pending_count: 0,
  quarantined_count: 0,
  sync_cursor: null,
  catalog_valid_until: null,
}

const compatibility = async () => ({
  api_protocol: { minimum: 2, maximum: 2 },
  minimum_pos_version: '1.4.0',
  backend_version: 'test',
})

const finalPull = async () => ({
  products: [],
  stock: [],
  cursor: '1',
  has_more: false,
  server_time: '2026-07-28T00:00:00.000Z',
  catalog_valid_until: '2026-07-29T00:00:00.000Z',
})

describe('acceptance-first POS synchronization', () => {
  it('classifies outages as retryable and corrupt/conflicting commands as permanent', () => {
    expect(isRetryableSyncError(new ApiError({ code: 'NETWORK_ERROR' }))).toBe(true)
    expect(isRetryableSyncError(new ApiError({}, 503))).toBe(true)
    expect(isRetryableSyncError(new ApiError({}, 429))).toBe(true)
    expect(isRetryableSyncError(new ApiError({}, 409))).toBe(false)
    expect(isRetryableSyncError(new ApiError({}, 422))).toBe(false)
    expect(isRetryableSyncError(new SyntaxError('bad payload'))).toBe(false)
  })

  it('uploads a completed local sale before compatibility and persists cloud warnings', async () => {
    const calls: any[] = []
    let outboxReads = 0
    const local: any = {
      sync_get_status: async () => ({
        ...status,
        pending_count: outboxReads === 0 ? 1 : 0,
      }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => {
        outboxReads += 1
        return outboxReads === 1
          ? [{
              id: 'sync-1',
              payload: JSON.stringify({
                event_version: 2,
                sync_id: 'sync-1',
                local_total: 100,
              }),
            }]
          : []
      },
      sync_mark_sending: async (id: string) => {
        calls.push(['sending', id])
        return { ok: true }
      },
      sync_mark_sent: async (value: any) => {
        calls.push(['sent', value])
        return { ok: true }
      },
      sync_mark_failed: async () => ({ ok: true }),
      sync_apply_pull: async () => ({ ok: true }),
    }
    const client: any = {
      compatibility: async () => {
        calls.push(['compatibility'])
        return compatibility()
      },
      heartbeat: async () => ({}),
      sale: async () => {
        calls.push(['sale'])
        return {
          id: 'server-id',
          invoice_number: 'B-BOLD-01-100',
          warning_codes: ['PRICE_VARIANCE'],
        }
      },
      pull: finalPull,
    }

    const result = await performSync('branch-1', local, client)

    expect(calls).toEqual([
      ['sending', 'sync-1'],
      ['sale'],
      ['sent', {
        id: 'sync-1',
        server_document_id: 'server-id',
        server_document_number: 'B-BOLD-01-100',
        warning_codes: ['PRICE_VARIANCE'],
      }],
      ['compatibility'],
    ])
    expect(result.sync_status).toBe('success')
    expect(result.pending_count).toBe(0)
  })

  it('keeps a sale pending after a temporary server failure', async () => {
    const failures: any[] = []
    let reads = 0
    const local: any = {
      sync_get_status: async () => ({ ...status, pending_count: 1 }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => {
        reads += 1
        return reads === 1
          ? [{ id: 'sync-retry', payload: '{}', attempt_count: 0 }]
          : []
      },
      sync_mark_sending: async () => ({ ok: true }),
      sync_mark_sent: async () => ({ ok: true }),
      sync_mark_failed: async (value: any) => {
        failures.push(value)
        return { ok: true }
      },
      sync_apply_pull: async () => ({ ok: true }),
    }
    const client: any = {
      compatibility,
      heartbeat: async () => ({}),
      sale: async () => {
        throw new ApiError({ code: 'SERVER_DOWN' }, 503)
      },
      pull: async () => {
        throw new Error('pull must not run after a temporary push failure')
      },
    }

    const result = await performSync('branch-1', local, client)

    expect(result.sync_status).toBe('error')
    expect(failures).toEqual([
      expect.objectContaining({ id: 'sync-retry', retryable: true }),
    ])
    expect(Date.parse(String(result.next_sync_at))).toBeGreaterThan(Date.now())
  })

  it('quarantines one corrupt operation without blocking later valid sales', async () => {
    const failures: any[] = []
    const sent: string[] = []
    let outboxReads = 0
    let saleCalls = 0
    const local: any = {
      sync_get_status: async () => ({
        ...status,
        quarantined_count: failures.length,
      }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => {
        outboxReads += 1
        return outboxReads === 1
          ? [
              { id: 'corrupt', payload: '{}' },
              { id: 'valid', payload: '{}' },
            ]
          : []
      },
      sync_mark_sending: async () => ({ ok: true }),
      sync_mark_sent: async (value: any) => {
        sent.push(value.id)
        return { ok: true }
      },
      sync_mark_failed: async (value: any) => {
        failures.push(value)
        return { ok: true }
      },
      sync_apply_pull: async () => ({ ok: true }),
    }
    const client: any = {
      compatibility,
      heartbeat: async () => ({}),
      sale: async () => {
        saleCalls += 1
        if (saleCalls === 1) {
          throw new ApiError({ code: 'SALE_PAYLOAD_CONFLICT' }, 409)
        }
        return { id: 'invoice-2', invoice_number: 'INV-2' }
      },
      pull: finalPull,
    }

    const result = await performSync('branch-1', local, client)

    expect(failures).toEqual([
      expect.objectContaining({ id: 'corrupt', retryable: false }),
    ])
    expect(sent).toEqual(['valid'])
    expect(result.sync_status).toBe('success')
    expect(result.quarantined_count).toBe(1)
  })

  it('finishes more than ten delta pages before restoring catalog validity', async () => {
    const applied: any[] = []
    let page = 0
    const local: any = {
      sync_get_status: async () => ({
        ...status,
        sync_cursor: '0',
        catalog_valid_until: 'old-validity',
      }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => [],
      sync_apply_pull: async (value: any) => {
        applied.push(value)
        return { ok: true }
      },
    }
    const client: any = {
      compatibility,
      heartbeat: async () => ({}),
      sale: async () => ({}),
      pull: async () => {
        page += 1
        return {
          products: [],
          stock: [],
          cursor: String(page),
          has_more: page < 12,
          server_time: `page-${page}`,
          catalog_valid_until: `valid-${page}`,
        }
      },
    }

    const result = await performSync('branch-1', local, client)

    expect(applied).toHaveLength(12)
    expect(applied.slice(0, -1).every(
      (value) => value.catalog_valid_until === null,
    )).toBe(true)
    expect(applied.at(-1).catalog_valid_until).toBe('valid-12')
    expect(result.sync_cursor).toBe('12')
  })

  it('rejects a paged response whose cursor does not advance', async () => {
    let applied = false
    const local: any = {
      sync_get_status: async () => ({ ...status, sync_cursor: '5' }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => [],
      sync_apply_pull: async () => {
        applied = true
        return { ok: true }
      },
    }
    const client: any = {
      compatibility,
      heartbeat: async () => ({}),
      pull: async () => ({
        products: [],
        stock: [],
        cursor: '5',
        has_more: true,
      }),
    }

    await expect(
      performSync('branch-1', local, client),
    ).rejects.toBeInstanceOf(SyncIntegrityError)
    expect(applied).toBe(false)
  })

  it('rejects a final response that moves the cursor backwards', async () => {
    const local: any = {
      sync_get_status: async () => ({ ...status, sync_cursor: '5' }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => [],
      sync_apply_pull: async () => {
        throw new Error('a regressing cursor must not be applied')
      },
    }
    const client: any = {
      compatibility,
      heartbeat: async () => ({}),
      pull: async () => ({
        products: [],
        stock: [],
        cursor: '4',
        has_more: false,
      }),
    }

    await expect(
      performSync('branch-1', local, client),
    ).rejects.toBeInstanceOf(SyncIntegrityError)
  })
})
