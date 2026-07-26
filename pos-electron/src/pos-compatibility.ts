import { compareVersions } from '../electron/update-policy'
import { POS_PROTOCOL_VERSION } from '../electron/pos-protocol'

export type CompatibleBackend = {
  protocol: number
  backendVersion: string
  deploymentSha: string | null
  minimumPosVersion: string
}

export class PosCompatibilityError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PosCompatibilityError'
    this.code = code
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null
}

export function assertPosCompatibility(
  payload: unknown,
  currentVersion: string,
): CompatibleBackend {
  const value = record(payload)
  const protocol = record(value?.api_protocol)
  const minimum = positiveInteger(protocol?.minimum)
  const maximum = positiveInteger(protocol?.maximum)
  const minimumPosVersion = String(
    value?.minimum_pos_version || '',
  ).trim()
  const backendVersion = String(
    value?.backend_version || '',
  ).trim()
  const deploymentSha = value?.deployment_sha
    ? String(value.deployment_sha).trim()
    : null

  if (
    !minimum ||
    !maximum ||
    minimum > maximum ||
    !minimumPosVersion ||
    !backendVersion
  ) {
    throw new PosCompatibilityError(
      'POS_COMPATIBILITY_RESPONSE_INVALID',
      'أعاد الخادم بيانات توافق غير مكتملة. أوقفت نقطة البيع المزامنة لحماية العمليات المحلية.',
    )
  }

  if (
    POS_PROTOCOL_VERSION < minimum ||
    POS_PROTOCOL_VERSION > maximum
  ) {
    throw new PosCompatibilityError(
      'POS_PROTOCOL_UNSUPPORTED',
      `بروتوكول نقطة البيع ${POS_PROTOCOL_VERSION} غير مدعوم بواسطة الخادم الحالي (${minimum}-${maximum}).`,
    )
  }

  try {
    if (compareVersions(currentVersion, minimumPosVersion) < 0) {
      throw new PosCompatibilityError(
        'POS_UPDATE_REQUIRED',
        `إصدار نقطة البيع ${currentVersion} أقدم من الحد الأدنى المطلوب ${minimumPosVersion}.`,
      )
    }
  } catch (error) {
    if (error instanceof PosCompatibilityError) throw error
    throw new PosCompatibilityError(
      'POS_COMPATIBILITY_RESPONSE_INVALID',
      'تعذر التحقق من أرقام إصدارات نقطة البيع والخادم.',
    )
  }

  return {
    protocol: POS_PROTOCOL_VERSION,
    backendVersion,
    deploymentSha,
    minimumPosVersion,
  }
}
