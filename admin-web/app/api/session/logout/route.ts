import { NextResponse } from 'next/server'
import {
  API_BASE,
  clearSessionCookies,
  sessionTokens,
} from '@/lib/server-session'

export async function POST() {
  const { refresh } = await sessionTokens()
  if (refresh) {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
      cache: 'no-store',
    }).catch(() => undefined)
  }
  const response = NextResponse.json({ ok: true })
  clearSessionCookies(response)
  return response
}
