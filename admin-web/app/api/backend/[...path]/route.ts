import { NextRequest, NextResponse } from 'next/server'
import {
  backendRequest,
  passBackendResponse,
} from '@/lib/server-session'

type Context = { params: Promise<{ path: string[] }> }

// CSRF defense-in-depth on top of SameSite=Strict: a mutating request that
// carries an Origin must come from this same host.
function isCrossOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin || ['GET', 'HEAD'].includes(request.method)) return false
  try {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

async function proxy(request: NextRequest, context: Context) {
  if (isCrossOrigin(request)) {
    return NextResponse.json({
      code: 'FORBIDDEN_ORIGIN',
      message_ar: 'الطلب مرفوض لأن مصدره غير مسموح.',
    }, { status: 403 })
  }
  const { path } = await context.params
  const safePath = path.map(segment => encodeURIComponent(segment)).join('/')
  const target = `/${safePath}${request.nextUrl.search}`
  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  headers.set('x-request-id', request.headers.get('x-request-id') || crypto.randomUUID())
  const hasBody = !['GET','HEAD'].includes(request.method)
  try {
    const result = await backendRequest(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
    })
    return passBackendResponse(result.backend, result.rotated)
  } catch {
    return NextResponse.json({
      code: 'NETWORK_ERROR',
      message_ar: 'لا يمكن الوصول إلى خادم النظام. تحقق من الاتصال ثم حاول مرة أخرى.',
    }, { status: 503 })
  }
}

export const GET = proxy
export const POST = proxy
export const PATCH = proxy
export const PUT = proxy
export const DELETE = proxy
