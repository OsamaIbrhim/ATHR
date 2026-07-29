const SENSITIVE_KEY = /(authorization|cookie|password|secret|token)/i
const BEARER_VALUE = /\bBearer\s+[^\s"']+/gi
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g

function sanitizeString(value: string) {
  return value
    .replace(BEARER_VALUE, 'Bearer [REDACTED]')
    .replace(JWT_VALUE, '[REDACTED_JWT]')
}

function redactValue(
  value: unknown,
  key: string,
  seen: WeakSet<object>,
): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return sanitizeString(value)
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    return value.map((item) => redactValue(item, '', seen))
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    const result: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = redactValue(childValue, childKey, seen)
    }
    return result
  }
  return String(value ?? '')
}

export function redactDiagnostics(value: unknown) {
  return redactValue(value, '', new WeakSet<object>())
}

export function serializeDiagnostics(value: unknown) {
  return JSON.stringify(redactDiagnostics(value), null, 2)
}

export function diagnosticFilename(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `athr-pos-diagnostics-${stamp}.json`
}
