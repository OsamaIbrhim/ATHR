import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const cookieValues: Record<string, string> = {}
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieValues ? { value: cookieValues[name] } : undefined) }),
}))

const fresh = { access_token: 'new-access', refresh_token: 'new-refresh', user: {} }

describe('backendRequest refresh', () => {
  beforeEach(() => {
    vi.resetModules()
    cookieValues.athr_admin_access = 'old-access'
    cookieValues.athr_admin_refresh = 'old-refresh'
  })

  it('shares one refresh call between concurrent 401s', async () => {
    let refreshCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++
        await new Promise(resolve => setTimeout(resolve, 20))
        return Response.json(fresh)
      }
      const auth = new Headers(init.headers).get('authorization')
      return auth === 'Bearer new-access' ? Response.json({ ok: true }) : new Response('', { status: 401 })
    }))
    const { backendRequest } = await import('./server-session')

    const results = await Promise.all(Array.from({ length: 5 }, () => backendRequest('/products')))

    expect(refreshCalls).toBe(1)
    for (const result of results) {
      expect(result.backend.status).toBe(200)
      expect(result.rotated?.access_token).toBe('new-access')
    }
  })

  it('does not cache a failed refresh', async () => {
    let refreshCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/auth/refresh')) refreshCalls++
      return new Response('', { status: 401 })
    }))
    const { backendRequest } = await import('./server-session')

    const first = await backendRequest('/products')
    await backendRequest('/products')

    expect(first.backend.status).toBe(401)
    expect(first.rotated).toBeUndefined()
    expect(refreshCalls).toBe(2)
  })
})
