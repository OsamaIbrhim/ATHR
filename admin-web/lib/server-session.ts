import 'server-only'

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const ACCESS_COOKIE = 'bold_admin_access'
const REFRESH_COOKIE = 'bold_admin_refresh'
const API_BASE = (
  process.env.API_INTERNAL_BASE ||
  process.env.NEXT_PUBLIC_API ||
  'http://localhost:3000/api/v1'
).replace(/\/$/, '')

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

  const refresh = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh }),
    cache: 'no-store',
  })
  if (!refresh.ok) return { backend }
  const rotated = await refresh.json() as BackendSession
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
