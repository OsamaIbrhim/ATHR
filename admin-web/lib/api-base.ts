export class AdminApiConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminApiConfigurationError'
  }
}

function isLoopback(hostname: string) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
}

export function normalizeAdminApiBase(
  rawValue: string,
  options: { production: boolean },
) {
  const value = String(rawValue || '').trim()
  if (!value) {
    throw new AdminApiConfigurationError(
      'ATHR_API_INTERNAL_BASE must be configured.',
    )
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AdminApiConfigurationError(
      'ATHR_API_INTERNAL_BASE must be a valid URL.',
    )
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new AdminApiConfigurationError(
      'ATHR API URL cannot contain credentials, query, or fragment.',
    )
  }
  if (
    options.production &&
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isLoopback(url.hostname))
  ) {
    throw new AdminApiConfigurationError(
      'ATHR production API must use HTTPS.',
    )
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AdminApiConfigurationError('ATHR API must use HTTP or HTTPS.')
  }
  const path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/api/v1')) {
    throw new AdminApiConfigurationError(
      'ATHR API URL must end with /api/v1.',
    )
  }
  return `${url.origin}${path}`
}

export function resolveAdminApiBase(
  env: NodeJS.ProcessEnv = process.env,
) {
  const configured = env.ATHR_API_INTERNAL_BASE
  const buildOnly =
    env.NEXT_PHASE === 'phase-production-build' && !configured
  const development = env.NODE_ENV !== 'production'
  const selected =
    configured ||
    (development || buildOnly
      ? 'http://localhost:3000/api/v1'
      : '')

  return normalizeAdminApiBase(selected, {
    production: env.NODE_ENV === 'production' && !buildOnly,
  })
}
