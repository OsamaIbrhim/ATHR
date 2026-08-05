import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createReleaseManifest,
  validateReleaseVersion,
  verifyReleaseManifest,
} from './pos-release.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Mirrors the real repository layout since the npm-workspaces migration
 * (PR #45): a single lockfile at the workspace root, with the `pos-electron`
 * member's own version recorded at `packages['pos-electron']`, not at the
 * lockfile's own top level or its `packages['']` (workspace root) entry.
 * The standalone-package shape this replaced is gone from the real repo —
 * a fixture still using it would keep this test green while the real
 * release workflow silently failed, which is exactly what happened between
 * 2026-07-30 (PR #45 merged) and this fix (every release attempt in that
 * window failed at the "Set up Node.js" step, see release run 30505336169).
 */
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'athr-pos-release-'))
  const packageDirectory = path.join(directory, 'pos-electron')
  mkdirSync(packageDirectory)
  const packageFile = path.join(packageDirectory, 'package.json')
  const lockFile = path.join(directory, 'package-lock.json')
  const installer = path.join(directory, 'ATHR-POS-Setup-1.3.3.exe')
  writeFileSync(packageFile, JSON.stringify({ name: 'athr-pos-electron', version: '1.3.3' }))
  writeFileSync(lockFile, JSON.stringify({
    name: 'athr-workspace',
    packages: {
      '': { name: 'athr-workspace', workspaces: ['pos-electron'] },
      'pos-electron': { name: 'athr-pos-electron', version: '1.3.3' },
    },
  }))
  writeFileSync(installer, 'installer bytes')
  return { directory, packageFile, lockFile, installer }
}

test('release version must match package files and tag', () => {
  const value = fixture()
  assert.deepEqual(validateReleaseVersion({
    version: '1.3.3',
    packageFile: value.packageFile,
    lockFile: value.lockFile,
    tag: 'athr-pos-v1.3.3',
  }), { version: '1.3.3', tag: 'athr-pos-v1.3.3' })
  assert.throws(() => validateReleaseVersion({
    version: '1.3.4',
    packageFile: value.packageFile,
    lockFile: value.lockFile,
    tag: 'athr-pos-v1.3.4',
  }), /does not match/)
})

test('validates this repository\'s actual root-workspace lockfile shape', () => {
  // The direct regression guard: this reads the real pos-electron/package.json
  // and the real root package-lock.json, so it fails loudly if either the
  // lockfile structure ever changes again, or a version bump ever lands in
  // one file but not the other — the exact class of drift that left the POS
  // release pipeline broken and unnoticed for a full release cycle.
  const packageFile = path.join(REPO_ROOT, 'pos-electron', 'package.json')
  const version = JSON.parse(readFileSync(packageFile, 'utf8')).version
  const result = validateReleaseVersion({
    version,
    packageFile,
    lockFile: path.join(REPO_ROOT, 'package-lock.json'),
    tag: `athr-pos-v${version}`,
  })
  assert.equal(result.version, version)
})

test('manifest contains a direct immutable release URL and installer checksum', async () => {
  const value = fixture()
  const manifest = await createReleaseManifest({
    installer: value.installer,
    version: '1.3.3',
    repository: 'OsamaIbrhim/bold_system',
    tag: 'athr-pos-v1.3.3',
    notes: 'Safe release',
    mandatory: false,
    publishedAt: '2026-07-27T12:00:00.000Z',
  })
  assert.equal(manifest.product, 'ATHR POS')
  assert.equal(manifest.channel, 'stable')
  assert.equal(manifest.url, 'https://github.com/OsamaIbrhim/bold_system/releases/download/athr-pos-v1.3.3/ATHR-POS-Setup-1.3.3.exe')
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/)

  const manifestFile = path.join(value.directory, 'pos-update.json')
  writeFileSync(manifestFile, JSON.stringify(manifest))
  await assert.doesNotReject(() => verifyReleaseManifest({
    manifestFile,
    installer: value.installer,
  }))
})

test('verification fails after installer tampering', async () => {
  const value = fixture()
  const manifest = await createReleaseManifest({
    installer: value.installer,
    version: '1.3.3',
    repository: 'OsamaIbrhim/bold_system',
    tag: 'athr-pos-v1.3.3',
    notes: 'Safe release',
    mandatory: false,
  })
  const manifestFile = path.join(value.directory, 'pos-update.json')
  writeFileSync(manifestFile, JSON.stringify(manifest))
  writeFileSync(value.installer, `${readFileSync(value.installer, 'utf8')} tampered`)
  await assert.rejects(() => verifyReleaseManifest({
    manifestFile,
    installer: value.installer,
  }), /checksum mismatch/)
})
