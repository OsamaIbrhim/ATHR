import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createReleaseManifest,
  validateReleaseVersion,
  verifyReleaseManifest,
} from './pos-release.mjs'

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'athr-pos-release-'))
  const packageFile = path.join(directory, 'package.json')
  const lockFile = path.join(directory, 'package-lock.json')
  const installer = path.join(directory, 'ATHR-POS-Setup-1.3.3.exe')
  writeFileSync(packageFile, JSON.stringify({ version: '1.3.3' }))
  writeFileSync(lockFile, JSON.stringify({ version: '1.3.3', packages: { '': { version: '1.3.3' } } }))
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
