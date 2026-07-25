import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiPost } from './api'

describe('Admin API session policy', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses the same-origin BFF without a JavaScript-readable bearer token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await apiPost('/reports/send', { channels: ['email'] })

    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/backend/reports/send')
    expect(init).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    }))
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
  })
})
