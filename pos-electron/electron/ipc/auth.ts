import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import {
  envelope,
  fetchWithTimeout,
  parseApiFailure,
  readJson,
  type ApiFailure,
} from '../api-client'
import {
  createOfflineLoginVerifier,
  normalizeLoginPhone,
  verifyOfflineLogin,
} from '../offline-login'
import {
  offlineAccountingContextMatches,
  toOfflineAccountingSummary,
} from '../offline-accounting'
import { publicDevice } from '../secure-public'
import {
  clearDeviceState,
  clearSessionState,
  readSecureState,
  writeSecureState,
  type AuthenticatedSession,
} from '../secure-state'
import { seedSequenceFromEnrollment } from '../sale-sequence'

function offlineCashierLogin(
  phone: string,
  password: string,
) {
  const state = readSecureState()
  const auth = state.auth
  const device = state.device
  const context = state.accounting
  const offlineUntil = Date.parse(
    String(auth?.offline_valid_until || ''),
  )

  if (
    !auth?.session?.user ||
    !device ||
    !context ||
    !Number.isFinite(offlineUntil) ||
    offlineUntil <= Date.now() ||
    !verifyOfflineLogin(
      state.offline_login,
      phone,
      password,
    ) ||
    !offlineAccountingContextMatches(
      context,
      {
        session: {
          user: auth.session.user,
        },
        device,
        shift: {
          id: context.shift_id,
          branch_id: context.branch_id,
        },
      },
    )
  ) {
    throw {
      message:
        'لا يمكن تسجيل الدخول دون اتصال بهذه البيانات. اتصل بالخادم لتجديد جلسة الكاشير وتفويض الوردية.',
      code: 'OFFLINE_LOGIN_UNAVAILABLE',
    } satisfies ApiFailure
  }

  return {
    session: { user: auth.session.user },
    accounting:
      toOfflineAccountingSummary(context),
    offline: true,
  }
}


export function registerAuthIpc() {
  ipcMain.handle(
    'api:enroll',
    (_event, enrollmentCode: string, terminal: any) =>
      envelope(async () => {
        const code = String(enrollmentCode || '')
          .trim()
          .toUpperCase()
        const deviceId = String(terminal?.device_id || '')
        const terminalName = String(
          terminal?.terminal_name || '',
        ).trim()
        const appVersion = String(
          terminal?.app_version || '',
        ).trim()
        if (
          code.length !== 12 ||
          !deviceId ||
          !terminalName ||
          !appVersion
        ) {
          throw {
            message: 'بيانات تسجيل الجهاز غير مكتملة.',
            code: 'TERMINAL_ENROLLMENT_INPUT_INVALID',
          } satisfies ApiFailure
        }

        const response = await fetchWithTimeout(
          '/terminals/enroll',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': randomUUID(),
            },
            body: JSON.stringify({
              enrollment_code: code,
              device_id: deviceId,
              name: terminalName,
              app_version: appVersion,
            }),
          },
        )
        if (!response.ok) await parseApiFailure(response)
        const result = await readJson(response)
        const enrolled = {
          device_id: deviceId,
          device_token: String(result?.device_token || ''),
          branch_id: String(
            result?.terminal?.branch?.id || '',
          ),
          terminal_id: String(result?.terminal?.id || ''),
          terminal_code: String(
            result?.terminal?.terminal_code || '',
          ),
          // WP-007 Phase C (BR-TRM-101/BR-ENR-102): a fresh enrollment always
          // gets an explicit tenant back from the server now.
          tenant_id: String(result?.terminal?.tenant_id || ''),
        }
        if (
          !enrolled.device_token ||
          !enrolled.branch_id ||
          !enrolled.terminal_id ||
          !enrolled.terminal_code ||
          !enrolled.tenant_id
        ) {
          throw {
            message:
              'أعاد الخادم بيانات تسجيل جهاز غير مكتملة.',
            code: 'TERMINAL_ENROLLMENT_RESPONSE_INVALID',
          } satisfies ApiFailure
        }

        const state = readSecureState()
        if (
          state.device?.terminal_id !==
          enrolled.terminal_id
        ) {
          delete state.auth
          delete state.accounting
          delete state.offline_login
        }
        state.device = enrolled
        writeSecureState(state)
        seedSequenceFromEnrollment(result?.terminal?.last_sale_sequence)
        return publicDevice(enrolled)
      }),
  )

  ipcMain.handle(
    'api:login',
    (_event, phone: string, password: string) =>
      envelope(async () => {
        const normalizedPhone =
          normalizeLoginPhone(phone)
        if (!normalizedPhone || String(password || '').length < 8) {
          throw {
            message: 'أدخل رقم الهاتف وكلمة المرور الصحيحين.',
            code: 'POS_LOGIN_INPUT_INVALID',
          } satisfies ApiFailure
        }

        let response: Response
        try {
          response = await fetchWithTimeout(
            '/auth/login',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-request-id': randomUUID(),
              },
              body: JSON.stringify({
                phone: normalizedPhone,
                password,
              }),
            },
          )
        } catch (error: any) {
          if (error?.code === 'NETWORK_ERROR') {
            return offlineCashierLogin(
              normalizedPhone,
              password,
            )
          }
          throw error
        }
        if (!response.ok) await parseApiFailure(response)
        const value =
          (await readJson(response)) as AuthenticatedSession
        const state = readSecureState()

        if (
          !value?.access_token ||
          !value?.refresh_token ||
          !value?.user?.id
        ) {
          throw {
            message:
              'أعاد الخادم جلسة دخول غير مكتملة.',
            code: 'POS_LOGIN_RESPONSE_INVALID',
          } satisfies ApiFailure
        }
        if (
          !['branch_manager', 'cashier'].includes(
            value.user.role,
          )
        ) {
          throw {
            message:
              'استخدم حساب كاشير أو مدير فرع في نقطة البيع.',
            code: 'POS_ROLE_DENIED',
          } satisfies ApiFailure
        }
        if (!value.user.branch_id) {
          throw {
            message:
              'يجب ربط حساب الكاشير بفرع من لوحة الإدارة.',
            code: 'USER_BRANCH_REQUIRED',
          } satisfies ApiFailure
        }
        if (
          !state.device ||
          value.user.branch_id !== state.device.branch_id
        ) {
          throw {
            message:
              'حساب الكاشير تابع لفرع مختلف عن هذا الجهاز.',
            code: 'USER_BRANCH_MISMATCH',
          } satisfies ApiFailure
        }

        delete state.accounting
        state.auth = {
          session: value,
          offline_valid_until: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        }
        state.offline_login =
          createOfflineLoginVerifier(
            normalizedPhone,
            password,
          )
        writeSecureState(state)
        return {
          session: { user: value.user },
          accounting: null,
          offline: false,
        }
      }),
  )

  ipcMain.handle(
    'api:logout',
    () =>
      envelope(async () => {
        const refreshToken =
          readSecureState().auth?.session?.refresh_token
        if (refreshToken) {
          await fetchWithTimeout('/auth/logout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': randomUUID(),
            },
            body: JSON.stringify({
              refresh_token: refreshToken,
            }),
          }).catch(() => undefined)
        }
        clearSessionState()
        return { cleared: true }
      }),
  )
  ipcMain.handle(
    'api:clear_session',
    () =>
      envelope(() => {
        clearSessionState()
        return { cleared: true }
      }),
  )

  ipcMain.handle(
    'api:clear_device',
    () =>
      envelope(() => {
        clearDeviceState()
        return { cleared: true }
      }),
  )
}
