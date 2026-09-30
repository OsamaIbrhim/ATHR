import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(async () => ({ backend: Response.json({ ok: true }) })),
}))

vi.mock('@/lib/server-session', () => ({
  backendRequest,
  passBackendResponse: async (backend: Response) => backend,
}))

import * as route from './route'

const context = { params: Promise.resolve({ path: ['products'] }) }

function call(method: string, headers: Record<string, string> = {}) {
  const request = new NextRequest('http://admin.test/api/backend/products', {
    method,
    headers: { host: 'admin.test', ...headers },
    body: method === 'GET' ? undefined : '{}',
  })
  return (route as any)[method](request, context) as Promise<Response>
}

describe('backend proxy', () => {
  it('rejects mutating requests from another origin', async () => {
    const response = await call('POST', { origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(backendRequest).not.toHaveBeenCalled()
  })

  it('rejects a malformed Origin header', async () => {
    expect((await call('DELETE', { origin: 'not a url' })).status).toBe(403)
  })

  it('allows same-origin and Origin-less mutations', async () => {
    expect((await call('PATCH', { origin: 'http://admin.test' })).status).toBe(200)
    expect((await call('POST')).status).toBe(200)
  })

  it('does not apply the Origin check to GET', async () => {
    expect((await call('GET', { origin: 'https://other.example' })).status).toBe(200)
  })

  it('exposes only the methods the app uses', () => {
    expect(Object.keys(route).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
  })
})
