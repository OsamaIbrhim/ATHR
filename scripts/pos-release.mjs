import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

function fail(message) {
  throw new Error(message)
}

function readJson(filename) {
  return JSON.parse(readFileSync(filename, 'utf8'))
}

function parseArgs(argv) {
  const result = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      result._.push(value)
      continue
    }
    const key = value.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) fail(`Missing value for --${key}`)
    result[key] = next
    index += 1
  }
  return result
}

function required(args, name) {
  const value = String(args[name] || '').trim()
  if (!value) fail(`--${name} is required`)
  return value
}

function booleanValue(value, name) {
  if (value === 'true') return true
  if (value === 'false') return false
  fail(`${name} must be true or false`)
}

export async function sha256File(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

export function validateReleaseVersion({ version, packageFile, lockFile, tag }) {
  if (!VERSION_PATTERN.test(version)) {
    fail('Release version must use stable MAJOR.MINOR.PATCH format')
  }
  const packageJson = readJson(packageFile)
  const lockJson = readJson(lockFile)
  const versions = [
    packageJson.version,
    lockJson.version,
    lockJson.packages?.['']?.version,
  ].map((value) => String(value || ''))
  if (versions.some((value) => value !== version)) {
    fail(`Release ${version} does not match package.json and package-lock.json: ${versions.join(', ')}`)
  }
  if (tag !== `pos-v${version}`) {
    fail(`Release tag must be pos-v${version}`)
  }
  return { version, tag }
}

export async function createReleaseManifest({
  installer,
  version,
  repository,
  tag,
  notes,
  mandatory,
  publishedAt = new Date().toISOString(),
}) {
  if (!VERSION_PATTERN.test(version)) fail('Manifest version is invalid')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail('GitHub repository must use owner/name format')
  }
  if (tag !== `pos-v${version}`) fail(`Manifest tag must be pos-v${version}`)
  const normalizedNotes = String(notes || '').trim()
  if (!normalizedNotes) fail('Release notes are required')
  if (normalizedNotes.length > 4_000) fail('Release notes must not exceed 4000 characters')
  if (!Number.isFinite(Date.parse(publishedAt))) fail('Publication date is invalid')

  const filename = path.basename(installer)
  const expectedFilename = `Bold-POS-Setup-${version}.exe`
  if (filename !== expectedFilename) {
    fail(`Installer must be named ${expectedFilename}`)
  }
  const sha256 = await sha256File(installer)
  const url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(filename)}`
  return {
    available: true,
    version,
    url,
    sha256,
    notes: normalizedNotes,
    mandatory,
    published_at: new Date(publishedAt).toISOString(),
  }
}

export async function verifyReleaseManifest({ manifestFile, installer }) {
  const manifest = readJson(manifestFile)
  assert.equal(manifest.available, true, 'Manifest must advertise an available release')
  assert.match(String(manifest.version || ''), VERSION_PATTERN, 'Manifest version is invalid')
  assert.equal(typeof manifest.mandatory, 'boolean', 'Manifest mandatory must be boolean')
  assert.match(String(manifest.sha256 || ''), SHA256_PATTERN, 'Manifest SHA-256 is invalid')
  const url = new URL(String(manifest.url || ''))
  assert.equal(url.protocol, 'https:', 'Installer URL must use HTTPS')
  assert.equal(decodeURIComponent(path.basename(url.pathname)), path.basename(installer), 'Installer URL filename mismatch')
  assert.equal(await sha256File(installer), manifest.sha256, 'Installer checksum mismatch')
  assert.ok(Number.isFinite(Date.parse(String(manifest.published_at || ''))), 'Publication date is invalid')
  return manifest
}

function releaseNotes({ version, notes, sha256, sourceSha }) {
  return [
    `# Bold POS ${version}`,
    '',
    notes.trim(),
    '',
    '## Verification',
    '',
    `- SHA-256: \`${sha256}\``,
    `- Source commit: \`${sourceSha}\``,
    '',
  ].join('\n')
}

async function main(argv) {
  const [command, ...rest] = argv
  const args = parseArgs(rest)

  if (command === 'validate') {
    validateReleaseVersion({
      version: required(args, 'version'),
      packageFile: required(args, 'package'),
      lockFile: required(args, 'lock'),
      tag: required(args, 'tag'),
    })
    return
  }

  if (command === 'create') {
    const notesEnv = required(args, 'notes-env')
    const notes = String(process.env[notesEnv] || '')
    const manifest = await createReleaseManifest({
      installer: required(args, 'installer'),
      version: required(args, 'version'),
      repository: required(args, 'repository'),
      tag: required(args, 'tag'),
      notes,
      mandatory: booleanValue(required(args, 'mandatory'), '--mandatory'),
      publishedAt: args['published-at'] || new Date().toISOString(),
    })
    writeFileSync(required(args, 'output'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    writeFileSync(
      required(args, 'notes-output'),
      releaseNotes({
        version: manifest.version,
        notes: manifest.notes,
        sha256: manifest.sha256,
        sourceSha: required(args, 'source-sha'),
      }),
      'utf8',
    )
    return
  }

  if (command === 'verify') {
    await verifyReleaseManifest({
      manifestFile: required(args, 'manifest'),
      installer: required(args, 'installer'),
    })
    return
  }

  fail('Usage: node scripts/pos-release.mjs <validate|create|verify> [options]')
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[POS_RELEASE] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
