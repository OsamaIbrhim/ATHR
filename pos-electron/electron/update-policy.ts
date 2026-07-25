export type UpdateManifest = {
  version: string
  url: string
  sha256: string
  notes: string | null
  mandatory: boolean
  publishedAt: string | null
}

type Version = {
  core: [number, number, number]
  prerelease: string[]
}

function parseVersion(value: string): Version | null {
  const match = String(value || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareIdentifier(left: string, right: string) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left.localeCompare(right)
}

export function compareVersions(leftValue: string, rightValue: string) {
  const left = parseVersion(leftValue)
  const right = parseVersion(rightValue)
  if (!left || !right) throw new Error('Invalid semantic version')

  for (let index = 0; index < left.core.length; index += 1) {
    const difference = left.core[index] - right.core[index]
    if (difference !== 0) return difference
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1
  if (right.prerelease.length === 0 && left.prerelease.length > 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const difference = compareIdentifier(leftPart, rightPart)
    if (difference !== 0) return difference
  }
  return 0
}

function httpsUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || '').trim())
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

export function selectUpdate(
  payload: unknown,
  currentVersion: string,
): UpdateManifest | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as Record<string, unknown>
  if (value.available !== true) return null

  const version = String(value.version || '').trim()
  const url = httpsUrl(value.url)
  const sha256 = String(value.sha256 || '').trim().toLowerCase()
  const publishedAt = value.published_at
    ? String(value.published_at).trim()
    : null

  if (
    !parseVersion(version) ||
    !parseVersion(currentVersion) ||
    !url ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    (publishedAt && !Number.isFinite(Date.parse(publishedAt)))
  ) {
    throw new Error('Invalid POS update manifest')
  }

  if (compareVersions(version, currentVersion) <= 0) return null

  return {
    version,
    url,
    sha256,
    notes: value.notes ? String(value.notes).slice(0, 2_000) : null,
    mandatory: value.mandatory === true,
    publishedAt,
  }
}
