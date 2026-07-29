const INVALID_RESOURCE_SEGMENTS = new Set(['undefined', 'null'])
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class ResourcePathError extends Error {
  readonly code = 'RESOURCE_PATH_INVALID'

  constructor(message = 'The resource path contains an invalid identifier') {
    super(message)
    this.name = 'ResourcePathError'
  }
}

export function requireResourceId(value: unknown, label = 'resource ID') {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (
    !normalized ||
    INVALID_RESOURCE_SEGMENTS.has(normalized.toLowerCase()) ||
    !UUID_PATTERN.test(normalized)
  ) {
    throw new ResourcePathError(`${label} must be a valid UUID`)
  }
  return normalized
}

export function assertSafeResourcePath(value: unknown) {
  const path = typeof value === 'string' ? value : ''
  if (!path.startsWith('/')) throw new ResourcePathError()

  let pathname: string
  try {
    pathname = new URL(path, 'https://athr.invalid').pathname
  } catch {
    throw new ResourcePathError()
  }

  const segments = pathname.split('/').slice(1)
  if (
    segments.some((segment) => {
      let decoded: string
      try {
        decoded = decodeURIComponent(segment).trim().toLowerCase()
      } catch {
        return true
      }
      return !decoded || INVALID_RESOURCE_SEGMENTS.has(decoded)
    })
  ) {
    throw new ResourcePathError()
  }
  return path
}

export function buildResourcePath(
  collection: string,
  id: unknown,
  suffix = '',
) {
  if (!collection.startsWith('/') || collection.endsWith('/')) {
    throw new ResourcePathError('Resource collection is invalid')
  }
  if (suffix && !suffix.startsWith('/')) {
    throw new ResourcePathError('Resource suffix is invalid')
  }
  return assertSafeResourcePath(
    `${collection}/${encodeURIComponent(requireResourceId(id))}${suffix}`,
  )
}
