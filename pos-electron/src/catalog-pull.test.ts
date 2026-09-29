import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { performSync, SyncIntegrityError } from './sync'

const status = {
  device_id: 'device',
  terminal_name: 'POS',
  app_version: '1.6.0',
  sync_status: 'never',
  last_sync_at: null,
  last_error: null,
  pending_count: 0,
  quarantined_count: 0,
  sync_cursor: null,
  catalog_valid_until: null,
}

const compatibility = async () => ({
  api_protocol: { minimum: 2, maximum: 3 },
  minimum_pos_version: '1.4.0',
  backend_version: 'test',
})

const page = (over: Record<string, unknown>) => ({
  catalog_version: 3,
  products: [],
  stock: [],
  deleted_variant_ids: [],
  server_time: 't',
  catalog_valid_until: 'valid',
  ...over,
})

const finalSnapshot = async () =>
  page({ mode: 'snapshot', cursor: '1:1', snapshot_after: null, has_more: false, reset_products: true })

/** A local bridge that records what the pull loop applied and reports resume state. */
function pullHarness(initial: Record<string, unknown> = {}) {
  const applied: any[] = []
  const local: any = {
    sync_get_status: async () => ({ ...status, ...initial }),
    sync_set_status: async () => ({ ok: true }),
    sync_get_outbox: async () => [],
    sync_apply_pull: async (value: any) => {
      applied.push(value)
      return { ok: true }
    },
  }
  return { local, applied }
}

function clientReturning(responses: any[], requests: any[] = []) {
  return {
    compatibility,
    heartbeat: async () => ({}),
    pull: async (_branch: string, position: any) => {
      requests.push(position)
      return responses[requests.length - 1]
    },
  } as any
}

describe('protocol 3 catalog pull', () => {
  it('pulls a multi-page snapshot: first page without cursor, then by snapshot_after', async () => {
    const requests: any[] = []
    const { local, applied } = pullHarness()
    const client = clientReturning(
      [
        page({ mode: 'snapshot', cursor: '7:3', snapshot_after: 'v-1000', has_more: true, reset_products: true }),
        page({ mode: 'snapshot', cursor: '7:3', snapshot_after: 'v-2000', has_more: true, reset_products: false }),
        page({ mode: 'snapshot', cursor: '7:3', snapshot_after: null, has_more: false, reset_products: false }),
      ],
      requests,
    )

    const result = await performSync('branch-1', local, client)

    expect(requests).toEqual([
      { cursor: null },
      { snapshot_after: 'v-1000', snapshot_cursor: '7:3' },
      { snapshot_after: 'v-2000', snapshot_cursor: '7:3' },
    ])
    // Checkout stays blocked until the last page commits.
    expect(applied.map((value) => value.catalog_valid_until)).toEqual([null, null, 'valid'])
    expect(result.sync_status).toBe('success')
    expect(result.sync_cursor).toBe('7:3')
  })

  it('resumes an interrupted snapshot from snapshot_after instead of restarting', async () => {
    const requests: any[] = []
    const { local } = pullHarness({ snapshot_after: 'v-5000', snapshot_cursor: '9:1' })
    const client = clientReturning(
      [page({ mode: 'snapshot', cursor: '9:1', snapshot_after: null, has_more: false, reset_products: false })],
      requests,
    )
    await performSync('branch-1', local, client)
    expect(requests).toEqual([{ snapshot_after: 'v-5000', snapshot_cursor: '9:1' }])
  })

  it('obeys the server: a delta request answered with a snapshot continues that snapshot', async () => {
    const requests: any[] = []
    const { local, applied } = pullHarness({ sync_cursor: '5:0' })
    const client = clientReturning(
      [
        page({ mode: 'snapshot', cursor: '8:2', snapshot_after: 'v-1000', has_more: true, reset_products: true }),
        page({ mode: 'snapshot', cursor: '8:2', snapshot_after: null, has_more: false, reset_products: false }),
      ],
      requests,
    )

    const result = await performSync('branch-1', local, client)

    expect(requests).toEqual([{ cursor: '5:0' }, { snapshot_after: 'v-1000', snapshot_cursor: '8:2' }])
    expect(applied.map((value) => value.mode)).toEqual(['snapshot', 'snapshot'])
    expect(result.sync_cursor).toBe('8:2')
  })

  it('keeps pulling a delta while has_more, by cursor', async () => {
    const requests: any[] = []
    const { local } = pullHarness({ sync_cursor: '5:0' })
    const client = clientReturning(
      [page({ mode: 'delta', cursor: '5:9', has_more: true }), page({ mode: 'delta', cursor: '6:2', has_more: false })],
      requests,
    )
    const result = await performSync('branch-1', local, client)
    expect(requests).toEqual([{ cursor: '5:0' }, { cursor: '5:9' }])
    expect(result.sync_cursor).toBe('6:2')
  })

  it.each([
    ['a snapshot page whose cursor drifts', { mode: 'snapshot', cursor: '7:4', snapshot_after: null, has_more: false, reset_products: false }],
    ['a snapshot page that does not advance', { mode: 'snapshot', cursor: '7:3', snapshot_after: 'v-5000', has_more: true, reset_products: false }],
    ['a snapshot continuation that resets the catalog', { mode: 'snapshot', cursor: '7:3', snapshot_after: null, has_more: false, reset_products: true }],
    ['an unknown mode', { mode: 'other', cursor: '7:3', has_more: false }],
    ['a delta answering a snapshot resume', { mode: 'delta', cursor: '7:3', has_more: false }],
  ])('rejects %s and applies nothing', async (_name, response) => {
    const { local, applied } = pullHarness({ snapshot_after: 'v-5000', snapshot_cursor: '7:3' })
    const client = clientReturning([page(response)])
    await expect(performSync('branch-1', local, client)).rejects.toBeInstanceOf(SyncIntegrityError)
    expect(applied).toHaveLength(0)
  })

  it('rejects a first snapshot page that does not reset the catalog', async () => {
    const { local } = pullHarness()
    const client = clientReturning([
      page({ mode: 'snapshot', cursor: '7:3', snapshot_after: null, has_more: false, reset_products: false }),
    ])
    await expect(performSync('branch-1', local, client)).rejects.toBeInstanceOf(SyncIntegrityError)
  })
})

describe('a sale upload refused because the app or protocol is not accepted', () => {
  function refusedSale(code: string, httpStatus: number) {
    const failures: any[] = []
    let pulled = false
    const local: any = {
      sync_get_status: async () => ({ ...status, pending_count: 1 }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () => [{ id: 'sale-1', payload: '{}', attempt_count: 0 }],
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
        throw new ApiError({ code, message_ar: 'حدّث التطبيق' }, httpStatus)
      },
      pull: async () => {
        pulled = true
        return finalSnapshot()
      },
    }
    return { local, client, failures, pulled: () => pulled }
  }

  it.each([
    ['POS_UPDATE_REQUIRED', 426],
    ['POS_PROTOCOL_UNSUPPORTED', 409],
  ])('keeps the sale pending on %s and blocks sync with a clear message', async (code, httpStatus) => {
    const { local, client, failures, pulled } = refusedSale(code, httpStatus)

    const result = await performSync('branch-1', local, client)

    expect(failures).toEqual([expect.objectContaining({ id: 'sale-1', retryable: true })])
    expect(pulled()).toBe(false)
    expect(result.sync_status).toBe('error')
    expect(result.blocked_reason).toBe(code)
    expect(result.last_error).toContain('حدّث التطبيق')
    expect(result.last_error).toContain('محفوظة على هذا الجهاز')
    // Retried later with backoff, so an update or a server fix unblocks it.
    expect(Date.parse(String(result.next_sync_at))).toBeGreaterThan(Date.now())
  })

  it('still quarantines a genuine payload conflict that shares the 409 status', async () => {
    const { local, client, failures } = refusedSale('SALE_PAYLOAD_CONFLICT', 409)
    await performSync('branch-1', local, client)
    expect(failures).toEqual([expect.objectContaining({ retryable: false })])
  })
})

describe('sales queued by POS 1.5.1', () => {
  it('uploads the stored size/color payload unchanged (the server fingerprint covers the label)', async () => {
    const stored = {
      event_version: 2,
      sync_id: 'sync-old',
      items: [
        {
          variant_id: 'v',
          qty: 2,
          unit_price: 100,
          unit_tax: 14,
          sku_snapshot: 'S',
          name_ar_snapshot: 'قميص',
          size_snapshot: 'L',
          color_snapshot: 'أسود',
        },
      ],
      local_total: 228,
    }
    const sent: any[] = []
    let reads = 0
    const local: any = {
      sync_get_status: async () => ({ ...status }),
      sync_set_status: async () => ({ ok: true }),
      sync_get_outbox: async () =>
        reads++ === 0 ? [{ id: 'sync-old', payload: JSON.stringify(stored), local_total: 228 }] : [],
      sync_mark_sending: async () => ({ ok: true }),
      sync_mark_sent: async () => ({ ok: true }),
      sync_mark_failed: async () => ({ ok: true }),
      sync_apply_pull: async () => ({ ok: true }),
    }
    const client: any = {
      compatibility,
      heartbeat: async () => ({}),
      sale: async (payload: any) => {
        sent.push(payload)
        return { id: 's' }
      },
      pull: finalSnapshot,
    }
    await performSync('branch-1', local, client)
    expect(sent).toEqual([stored])
  })
})
