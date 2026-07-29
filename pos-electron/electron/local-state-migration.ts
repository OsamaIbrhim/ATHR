import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { createHash } from 'crypto'
import * as path from 'path'

const LEGACY_DIRECTORIES = ['bold-pos-electron', 'Bold POS']

function sha256(file: string) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function copyVerified(source: string, target: string) {
  if (!existsSync(source) || existsSync(target)) return false
  mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.migrating`
  try {
    copyFileSync(source, temporary)
    if (sha256(source) !== sha256(temporary)) {
      throw new Error(`Local state copy verification failed for ${source}`)
    }
    renameSync(temporary, target)
    return true
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true })
  }
}

export function migrateLegacyLocalState(input: {
  appDataDirectory: string
  targetDirectory: string
}) {
  const targetDatabase = path.join(input.targetDirectory, 'athr_pos.sqlite')
  const targetSecureState = path.join(input.targetDirectory, 'secure-state.bin')
  const candidateDirectories = [
    input.targetDirectory,
    ...LEGACY_DIRECTORIES.map((name) =>
      path.join(input.appDataDirectory, name),
    ),
  ]

  let databaseSource: string | null = null
  let secureStateSource: string | null = null

  for (const directory of candidateDirectories) {
    if (
      !databaseSource &&
      copyVerified(path.join(directory, 'bold_pos.sqlite'), targetDatabase)
    ) {
      databaseSource = directory
    }
    if (
      !secureStateSource &&
      copyVerified(path.join(directory, 'secure-state.bin'), targetSecureState)
    ) {
      secureStateSource = directory
    }
  }

  if (databaseSource || secureStateSource) {
    writeFileSync(
      path.join(input.targetDirectory, 'athr-local-state-migration.json'),
      JSON.stringify(
        {
          version: 1,
          migrated_at: new Date().toISOString(),
          database_source: databaseSource,
          secure_state_source: secureStateSource,
          source_preserved: true,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    )
  }

  return {
    databaseMigrated: Boolean(databaseSource),
    secureStateMigrated: Boolean(secureStateSource),
  }
}
