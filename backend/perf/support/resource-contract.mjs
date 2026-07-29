export class ResourceContractError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ResourceContractError'
    this.details = details
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVALID_RESOURCE_SEGMENTS = new Set(['undefined', 'null'])

export function parseJsonResponseBody(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 500) }
  }
}

export function requireNonEmptyString(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized === 'undefined' || normalized === 'null') {
    throw new ResourceContractError(`${label} must be a non-empty string`, {
      label,
      received_type: value === null ? 'null' : typeof value,
    })
  }
  return normalized
}

export function requireResourceId(value, label) {
  const id = requireNonEmptyString(value, label)
  if (!UUID_PATTERN.test(id)) {
    throw new ResourceContractError(`${label} must contain a valid UUID`, {
      label,
    })
  }
  return id
}

export function requireResourceRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResourceContractError(`${label} must be a resource object`, {
      label,
      received_type: value === null ? 'null' : typeof value,
    })
  }
  requireResourceId(value.id, `${label}.id`)
  return value
}

export function buildResourcePath(collection, id, suffix = '') {
  if (
    typeof collection !== 'string' ||
    !collection.startsWith('/') ||
    collection.endsWith('/')
  ) {
    throw new ResourceContractError(
      'Resource collection must start with one slash and must not end with a slash',
      { collection },
    )
  }
  if (typeof suffix !== 'string' || (suffix && !suffix.startsWith('/'))) {
    throw new ResourceContractError('Resource path suffix must start with a slash', {
      suffix,
    })
  }
  return assertSafeResourcePath(
    `${collection}/${encodeURIComponent(
      requireResourceId(id, `${collection} resource ID`),
    )}${suffix}`,
  )
}

export function assertSafeResourcePath(value) {
  const path = typeof value === 'string' ? value : ''
  if (!path.startsWith('/')) {
    throw new ResourceContractError('Request path must be relative to the API')
  }

  let pathname
  try {
    pathname = new URL(path, 'https://athr.invalid').pathname
  } catch {
    throw new ResourceContractError('Request path is invalid')
  }

  const segments = pathname.split('/').slice(1)
  if (
    segments.some((segment) => {
      let decoded
      try {
        decoded = decodeURIComponent(segment).trim().toLowerCase()
      } catch {
        return true
      }
      return !decoded || INVALID_RESOURCE_SEGMENTS.has(decoded)
    })
  ) {
    throw new ResourceContractError(
      'Request path contains an invalid resource segment',
      { path },
    )
  }
  return path
}

export async function resolveResource(fetchCurrent, createResource, label) {
  const current = await fetchCurrent()
  if (current !== null && current !== undefined) {
    return requireResourceRecord(current, label)
  }
  return requireResourceRecord(await createResource(), label)
}
