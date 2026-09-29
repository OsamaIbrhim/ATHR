import { ApiConfigurationError, normalizeApiBase } from '../api-base'
import { app, ipcMain } from 'electron'
import { authenticatedFetch, envelope, type ApiFailure } from '../api-client'
import { reconcileDeviceTenantId } from '../device-tenant-migration'
import {
  apiConfiguration,
  setConfiguredApiBase,
  writeDeploymentConfig,
} from '../deployment-config'
import {
  offlineAccountingContextMatches,
  toOfflineAccountingSummary,
  type OfflineAccountingContext,
} from '../offline-accounting'
import { buildResourcePath, requireResourceId } from '../resource-path'
import { assertAllowedApiRequest } from '../api-policy'
import { alignLocalSequence } from '../sale-sequence'
import {
  publicBootstrapState,
  readSecureState,
  saveAuthenticatedSession,
  writeSecureState,
} from '../secure-state'
import { ensureAutoUpdates } from '../updates'

export function registerApiIpc() {
  ipcMain.handle(
    'api:bootstrap',
    () =>
      envelope(() => ({
        ...publicBootstrapState(),
        configuration: apiConfiguration(),
      })),
  )

  ipcMain.handle('api:get_config', () => envelope(() => apiConfiguration()))

  ipcMain.handle(
    'api:set_base_url',
    (_event, rawValue: string) =>
      envelope(() => {
        const environmentValue = String(process.env.ATHR_API_URL || '').trim()
        const apiBaseUrl = normalizeApiBase(rawValue, {
          packaged: app.isPackaged,
        })
        if (
          environmentValue &&
          normalizeApiBase(environmentValue, { packaged: app.isPackaged }) !==
            apiBaseUrl
        ) {
          throw new ApiConfigurationError(
            'عنوان الخادم مضبوط بواسطة بيئة التشغيل ولا يمكن تغييره من الجهاز.',
          )
        }
        if (!environmentValue) writeDeploymentConfig(apiBaseUrl)
        setConfiguredApiBase(apiBaseUrl)
        ensureAutoUpdates()
        return apiConfiguration()
      }),
  )

  ipcMain.handle(
    'api:request',
    (_event, input: any) =>
      envelope(async () => {
        const request = assertAllowedApiRequest(
          input?.path,
          input?.method,
        )
        const result = await authenticatedFetch(
          request.pathname,
          {
            method: request.method,
            body: input?.body,
          },
        )

        if (request.pathname === '/auth/me') {
          const state = readSecureState()
          if (state.auth?.session && result?.id) {
            saveAuthenticatedSession({
              ...state.auth.session,
              user: {
                ...state.auth.session.user,
                ...result,
              },
            })
          }
        }
        if (request.pathname === '/terminals/heartbeat') {
          // WP-007 Phase C: a terminal enrolled before this release has no
          // tenant_id in its local state. The heartbeat this terminal already
          // sends periodically carries one, so it self-heals here — no
          // re-enrollment required.
          const state = readSecureState()
          const migratedDevice = reconcileDeviceTenantId(
            state.device ?? null,
            result?.terminal,
          )
          if (migratedDevice && migratedDevice !== state.device) {
            state.device = migratedDevice
            writeSecureState(state)
          }
        }
        return result
      }),
  )

  ipcMain.handle(
    'api:clear_accounting',
    () =>
      envelope(() => {
        const state = readSecureState()
        delete state.accounting
        writeSecureState(state)
        return { cleared: true }
      }),
  )

  ipcMain.handle(
    'api:issue_accounting',
    (_event, shiftId: string) =>
      envelope(async () => {
        const normalizedShiftId = requireResourceId(
          shiftId,
          'Shift ID',
        )
        const context =
          (await authenticatedFetch(
            buildResourcePath(
              '/shifts',
              normalizedShiftId,
              '/offline-context',
            ),
            { method: 'POST' },
          )) as OfflineAccountingContext
        const state = readSecureState()
        const user = state.auth?.session?.user
        const device = state.device
        if (
          !user ||
          !device ||
          !offlineAccountingContextMatches(
            context,
            {
              session: { user },
              device,
              shift: {
                id: normalizedShiftId,
                branch_id: user.branch_id,
              },
            },
          )
        ) {
          throw {
            message:
              'أعاد الخادم بيانات لا تطابق الكاشير أو الجهاز أو الوردية الحالية.',
            code: 'OFFLINE_SALE_CONTEXT_INVALID',
          } satisfies ApiFailure
        }

        alignLocalSequence(context)
        state.accounting = context
        writeSecureState(state)
        return toOfflineAccountingSummary(context)
      }),
  )
}
