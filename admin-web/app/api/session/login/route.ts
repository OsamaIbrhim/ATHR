import { NextRequest, NextResponse } from 'next/server'
import { API_BASE, writeSession } from '@/lib/server-session'

export async function POST(request: NextRequest) {
  const body = await request.text()
  let backend: Response
  try {
    backend = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': request.headers.get('x-request-id') || crypto.randomUUID(),
      },
      body,
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json({
      code: 'NETWORK_ERROR',
      message_ar: 'لا يمكن الوصول إلى خادم النظام.',
    }, { status: 503 })
  }
  const payload = await backend.json().catch(() => ({}))
  if (!backend.ok) return NextResponse.json(payload, { status: backend.status })
  const response = NextResponse.json({ user: payload.user })
  writeSession(response, payload)
  return response
}
