import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyLocalState } from './local-state-migration'

const temporaryDirectories: string[] = []

function temporaryDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), 'athr-local-state-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
  }
})

describe('ATHR local state migration', () => {
  it('copies the legacy database and credentials without deleting their source', () => {
    const appDataDirectory = temporaryDirectory()
    const targetDirectory = path.join(appDataDirectory, 'athr-pos-electron')
    const legacyDirectory = path.join(appDataDirectory, 'bold-pos-electron')
    mkdirSync(legacyDirectory, { recursive: true })
    writeFileSync(path.join(legacyDirectory, 'bold_pos.sqlite'), 'pending-sale')
    writeFileSync(path.join(legacyDirectory, 'secure-state.bin'), 'credentials')

    expect(
      migrateLegacyLocalState({ appDataDirectory, targetDirectory }),
    ).toEqual({
      databaseMigrated: true,
      secureStateMigrated: true,
    })
    expect(
      readFileSync(path.join(targetDirectory, 'athr_pos.sqlite'), 'utf8'),
    ).toBe('pending-sale')
    expect(
      readFileSync(path.join(targetDirectory, 'secure-state.bin'), 'utf8'),
    ).toBe('credentials')
    expect(existsSync(path.join(legacyDirectory, 'bold_pos.sqlite'))).toBe(true)
  })

  it('never overwrites an existing ATHR database', () => {
    const appDataDirectory = temporaryDirectory()
    const targetDirectory = path.join(appDataDirectory, 'athr-pos-electron')
    mkdirSync(targetDirectory, { recursive: true })
    writeFileSync(path.join(targetDirectory, 'bold_pos.sqlite'), 'legacy')
    writeFileSync(path.join(targetDirectory, 'athr_pos.sqlite'), 'current')

    migrateLegacyLocalState({ appDataDirectory, targetDirectory })

    expect(
      readFileSync(path.join(targetDirectory, 'athr_pos.sqlite'), 'utf8'),
    ).toBe('current')
  })
})
