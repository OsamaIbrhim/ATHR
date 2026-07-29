import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiGet, apiPost } from './api'
import { ResourcePathError } from './resource-path'

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

  it.each([
    '/sales/undefined',
    '/shifts/null/close',
    '/terminals/%75ndefined',
  ])('rejects invalid resource paths before fetch: %s', async (path) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(apiGet(path)).rejects.toBeInstanceOf(ResourcePathError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
