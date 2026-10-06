import 'server-only'

import { createHash } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { resolveAdminApiBase } from './api-base'

const ACCESS_COOKIE = 'athr_admin_access'
const REFRESH_COOKIE = 'athr_admin_refresh'
const API_BASE = resolveAdminApiBase()

type BackendSession = {
  access_token: string
  refresh_token: string
  user: unknown
}

function accessMaxAge(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return Math.max(60, Number(payload.exp) - Math.floor(Date.now() / 1000))
  } catch {
    return 15 * 60
  }
}

export function writeSession(response: NextResponse, session: BackendSession) {
  const common = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  }
  response.cookies.set(ACCESS_COOKIE, session.access_token, {
    ...common,
    maxAge: accessMaxAge(session.access_token),
  })
  response.cookies.set(REFRESH_COOKIE, session.refresh_token, {
    ...common,
    maxAge: 30 * 24 * 60 * 60,
  })
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE, '', { path: '/', maxAge: 0 })
  response.cookies.set(REFRESH_COOKIE, '', { path: '/', maxAge: 0 })
}

export async function sessionTokens() {
  const store = await cookies()
  return {
    access: store.get(ACCESS_COOKIE)?.value || '',
    refresh: store.get(REFRESH_COOKIE)?.value || '',
  }
}

// The backend rotates refresh tokens, so concurrent 401s carrying the same
// token must share one refresh call. The settled entry is kept briefly so a
// slightly late 401 (still holding the old cookie) reuses the result too.
const REFRESH_REUSE_MS = 10_000
const refreshes = new Map<string, Promise<BackendSession | null>>()

function refreshOnce(refreshToken: string) {
  const key = createHash('sha256').update(refreshToken).digest('hex')
  let inFlight = refreshes.get(key)
  if (!inFlight) {
    const expire = () => refreshes.delete(key)
    inFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    }).then(res => (res.ok ? res.json() as Promise<BackendSession> : null))
    inFlight.then(
      session => (session ? setTimeout(expire, REFRESH_REUSE_MS).unref?.() : expire()),
      expire,
    )
    refreshes.set(key, inFlight)
  }
  return inFlight
}

export async function backendRequest(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<{ backend: Response; rotated?: BackendSession }> {
  const tokens = await sessionTokens()
  const headers = new Headers(init.headers)
  if (tokens.access) headers.set('authorization', `Bearer ${tokens.access}`)
  const backend = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  })
  if (backend.status !== 401 || !retry || !tokens.refresh) return { backend }

  const rotated = await refreshOnce(tokens.refresh)
  if (!rotated) return { backend }
  headers.set('authorization', `Bearer ${rotated.access_token}`)
  return {
    backend: await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    }),
    rotated,
  }
}

export async function passBackendResponse(
  backend: Response,
  rotated?: BackendSession,
) {
  const headers = new Headers()
  const contentType = backend.headers.get('content-type')
  const requestId = backend.headers.get('x-request-id')
  if (contentType) headers.set('content-type', contentType)
  if (requestId) headers.set('x-request-id', requestId)
  const response = new NextResponse(await backend.arrayBuffer(), {
    status: backend.status,
    headers,
  })
  if (rotated) writeSession(response, rotated)
  if (backend.status === 401) clearSessionCookies(response)
  return response
}

export { API_BASE }
