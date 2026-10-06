import { assertSafeApiPath } from './resource-path'

const API_BASE = '/api/backend'

const inFlightGets = new Map<string, Promise<any>>()

export type ApiErrorPayload = {
  code?: string
  message?: string
  message_ar?: string
  field?: string
  details?: string[]
  data?: any
  request_id?: string
}

const fieldLabels: Record<string, string> = {
  name: 'الاسم',
  name_ar: 'الاسم العربي',
  name_en: 'الاسم الإنجليزي',
  phone: 'رقم الهاتف',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  sku: 'رمز SKU',
  code: 'الباركود',
  pack_qty: 'كمية العبوة',
  attributes: 'الخصائص',
  enrollment_code: 'رمز تسجيل الجهاز',
  branch_id: 'الفرع',
  quantity: 'الكمية',
}

export class ApiError extends Error {
  code: string
  field?: string
  details: string[]
  /** Structured extras of a domain error (per-row results, `line_index`, `count_id`...). */
  data?: any
  requestId?: string

  constructor(payload: ApiErrorPayload, status?: number) {
    const message = payload.message_ar || payload.message || `تعذر إتمام الطلب${status ? ` (HTTP ${status})` : ''}`
    const fieldHint = payload.field ? fieldLabels[payload.field] || payload.field : ''
    super(`${message}${fieldHint ? ` الحقل المطلوب مراجعته: ${fieldHint}.` : ''}`)
    this.name = 'ApiError'
    this.code = payload.code || 'REQUEST_FAILED'
    this.field = payload.field
    this.details = payload.details || []
    this.data = payload.data
    this.requestId = payload.request_id
  }
}

async function readApiError(response: Response) {
  const body = await response.json().catch(async () => ({ message: await response.text().catch(() => response.statusText) }))
  return new ApiError(body || {}, response.status)
}

function clearSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('user')
}

async function authorizedFetch(path: string, init: RequestInit = {}) {
  assertSafeApiPath(path)
  const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'x-request-id': requestId,
        ...(init.headers || {}),
      },
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message_ar: 'لا يمكن الوصول إلى الخادم. تحقق من تشغيل الخادم والاتصال بالشبكة ثم حاول مرة أخرى.',
      message: 'The server cannot be reached. Check the server and network, then try again.',
      request_id: requestId,
    })
  }
  return response
}

async function handleResponse(res: Response, path: string) {
  if (res.status === 401) {
    clearSession()
    if (typeof window !== 'undefined') {
      const next = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/login?next=${next}`
    }
    throw new ApiError({ code: 'UNAUTHORIZED', message_ar: 'انتهت الجلسة. سجل الدخول مرة أخرى.' }, 401)
  }
  if (!res.ok) {
    throw await readApiError(res)
  }
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : res.text()
}

export async function apiGet(path: string) {
  const existing = inFlightGets.get(path)
  if (existing) return existing
  const request = authorizedFetch(path)
    .then(response => handleResponse(response, path))
    .finally(() => inFlightGets.delete(path))
  inFlightGets.set(path, request)
  return request
}

export async function apiPost(path: string, body: any) {
  return handleResponse(await authorizedFetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), path)
}

export async function apiPatch(path: string, body: any) {
  return handleResponse(await authorizedFetch(path, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), path)
}

export async function apiPut(path: string, body: any) {
  return handleResponse(await authorizedFetch(path, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), path)
}

export async function apiDelete(path: string) {
  return handleResponse(await authorizedFetch(path, { method: 'DELETE' }), path)
}

export async function apiGetBlob(path: string) {
  const response = await authorizedFetch(path)
  if (!response.ok) {
    throw await readApiError(response)
  }
  return response.blob()
}

export type AdminUser = {
  id: string
  name: string
  /** Client-compatible role name (owner, branch_manager, ...). */
  role: string
  membership_role?: string
  branch_id: string | null
  /** Effective permission keys of the session's membership. */
  permissions?: string[]
}

export function getStoredUser(): AdminUser | null {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem('user') || 'null') }
  catch { return null }
}

export async function apiLogout() {
  await fetch('/api/session/logout', { method: 'POST' }).catch(() => undefined)
  clearSession()
}

export const API = API_BASE
