import { app } from 'electron'
import { randomUUID } from 'crypto'
import { currentApiBase } from './deployment-config'
import { POS_PROTOCOL_VERSION } from './pos-protocol'
import {
  readSecureState,
  saveAuthenticatedSession,
  type AuthenticatedSession,
} from './secure-state'

export type ApiFailure = {
  message: string
  code: string
  field?: string
  request_id?: string
  status?: number
  retry_after_ms?: number
  details?: string[]
}

type RefreshResult = 'refreshed' | 'rejected' | 'network_error'

const API_TIMEOUT_MS = 15_000
let refreshPromise: Promise<RefreshResult> | null = null

function apiFailure(error: any): ApiFailure {
  return {
    message:
      error?.message ||
      'تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.',
    code: error?.code || 'UNKNOWN_ERROR',
    field: error?.field,
    request_id: error?.request_id,
    status: error?.status,
    retry_after_ms: Number.isFinite(Number(error?.retry_after_ms))
      ? Number(error.retry_after_ms)
      : undefined,
    details: Array.isArray(error?.details)
      ? error.details.map(String)
      : undefined,
  }
}

/** Wraps an IPC operation into the `{ ok, data | error }` contract the renderer expects. */
export function envelope<T>(operation: () => T | Promise<T>) {
  return Promise.resolve()
    .then(operation)
    .then((data) => ({ ok: true as const, data }))
    .catch((error) => ({
      ok: false as const,
      error: apiFailure(error),
    }))
}

export async function fetchWithTimeout(
  pathname: string,
  init: RequestInit = {},
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    return await fetch(`${currentApiBase()}${pathname}`, {
      ...init,
      signal: controller.signal,
    })
  } catch {
    throw {
      message:
        'لا يمكن الوصول إلى الخادم. تحقق من الإنترنت أو عنوان الخادم.',
      code: 'NETWORK_ERROR',
    } satisfies ApiFailure
  } finally {
    clearTimeout(timer)
  }
}

export async function parseApiFailure(response: Response) {
  const payload = await response.json().catch(() => ({}))
  throw {
    message:
      payload.message_ar ||
      payload.message ||
      'تعذر تنفيذ الطلب.',
    code: payload.code || `HTTP_${response.status}`,
    field: payload.field,
    request_id: payload.request_id,
    status: response.status,
    retry_after_ms: Number.isFinite(Number(payload.retry_after_ms))
      ? Number(payload.retry_after_ms)
      : undefined,
    details: Array.isArray(payload.details)
      ? payload.details.map(String)
      : undefined,
  } satisfies ApiFailure
}

export async function readJson(response: Response) {
  if (response.status === 204) return null
  return response.json()
}

async function refreshSession(): Promise<RefreshResult> {
  const refreshToken = readSecureState().auth?.session?.refresh_token
  if (!refreshToken) return 'rejected'

  if (!refreshPromise) {
    refreshPromise = (async () => {
      let response: Response
      try {
        response = await fetchWithTimeout('/auth/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': randomUUID(),
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
      } catch {
        return 'network_error' as const
      }

      if (!response.ok) return 'rejected' as const
      saveAuthenticatedSession((await readJson(response)) as AuthenticatedSession)
      return 'refreshed' as const
    })().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

export async function authenticatedFetch(
  pathname: string,
  input: { method?: string; body?: unknown } = {},
  retry = true,
): Promise<any> {
  const state = readSecureState()
  const response = await fetchWithTimeout(pathname, {
    method: input.method || 'GET',
    headers: {
      ...(input.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(state.auth?.session?.access_token
        ? { Authorization: `Bearer ${state.auth.session.access_token}` }
        : {}),
      ...(state.device?.device_token
        ? { 'x-pos-device-token': state.device.device_token }
        : {}),
      ...(state.device?.device_id
        ? { 'x-pos-device-id': state.device.device_id }
        : {}),
      'x-pos-app-version': app.getVersion(),
      'x-pos-protocol-version': String(POS_PROTOCOL_VERSION),
      'x-request-id': randomUUID(),
    },
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
  })

  if (response.status === 401 && retry) {
    const refresh = await refreshSession()
    if (refresh === 'refreshed') {
      return authenticatedFetch(pathname, input, false)
    }
    if (refresh === 'network_error') {
      throw {
        message:
          'انقطع الاتصال أثناء تجديد الجلسة. لم يتم حذف تسجيل الجهاز أو بيانات الدخول.',
        code: 'NETWORK_ERROR',
      } satisfies ApiFailure
    }
  }

  if (!response.ok) await parseApiFailure(response)
  return readJson(response)
}
