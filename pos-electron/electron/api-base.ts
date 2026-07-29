export class ApiConfigurationError extends Error {
  readonly code = 'API_CONFIGURATION_REQUIRED'

  constructor(message: string) {
    super(message)
    this.name = 'ApiConfigurationError'
  }
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

export function normalizeApiBase(
  rawValue: string,
  options: { packaged: boolean },
) {
  const value = String(rawValue || '').trim()
  if (!value) {
    throw new ApiConfigurationError('عنوان خادم ATHR مطلوب قبل تسجيل الجهاز.')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiConfigurationError('عنوان خادم ATHR غير صالح.')
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new ApiConfigurationError(
      'عنوان خادم ATHR لا يقبل بيانات دخول أو query أو fragment.',
    )
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ApiConfigurationError('عنوان خادم ATHR يجب أن يستخدم HTTP أو HTTPS.')
  }
  if (options.packaged && url.protocol !== 'https:') {
    throw new ApiConfigurationError(
      'نسخة الإنتاج من ATHR POS تتطلب عنوان HTTPS.',
    )
  }
  if (
    !options.packaged &&
    url.protocol === 'http:' &&
    !isLocalHostname(url.hostname)
  ) {
    throw new ApiConfigurationError(
      'HTTP مسموح محليًا فقط؛ استخدم HTTPS للخادم البعيد.',
    )
  }

  const path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/api/v1')) {
    throw new ApiConfigurationError(
      'عنوان خادم ATHR يجب أن ينتهي بالمسار /api/v1.',
    )
  }

  return `${url.origin}${path}`
}

export function resolveApiBase(input: {
  environmentValue?: string
  persistedValue?: string
  packaged: boolean
}) {
  const environmentValue = String(input.environmentValue || '').trim()
  const persistedValue = String(input.persistedValue || '').trim()
  const selected =
    environmentValue ||
    persistedValue ||
    (input.packaged ? '' : 'http://localhost:3000/api/v1')

  return {
    apiBase: normalizeApiBase(selected, { packaged: input.packaged }),
    source: environmentValue
      ? ('environment' as const)
      : persistedValue
        ? ('device' as const)
        : ('development' as const),
    locked: Boolean(environmentValue),
  }
}
