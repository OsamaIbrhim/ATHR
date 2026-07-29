const INVALID_RESOURCE_SEGMENTS = new Set(['undefined', 'null'])

export class ResourcePathError extends Error {
  readonly code = 'RESOURCE_PATH_INVALID'

  constructor() {
    super('The API path contains an invalid resource identifier')
    this.name = 'ResourcePathError'
  }
}

export function assertSafeApiPath(value: unknown) {
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
