import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athr-secure-'))
const decrypt = vi.fn((buffer: Buffer) => buffer.toString('utf8'))

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (buffer: Buffer) => decrypt(buffer),
  },
}))

import {
  invalidateSecureState,
  readSecureState,
  writeSecureState,
} from './secure-state'

describe('secure state cache', () => {
  beforeEach(() => {
    invalidateSecureState()
    decrypt.mockClear()
    fs.writeFileSync(path.join(dir, 'secure-state.bin'), JSON.stringify({ device: { device_id: 'd1' } }))
  })

  it('decrypts once and serves later reads from memory', () => {
    for (let i = 0; i < 5; i += 1) expect(readSecureState().device?.device_id).toBe('d1')
    expect(decrypt).toHaveBeenCalledTimes(1)
  })

  it('hands out independent copies so a failed mutation cannot poison the cache', () => {
    readSecureState().device!.device_id = 'mutated'
    expect(readSecureState().device?.device_id).toBe('d1')
  })

  it('reflects a write without another decrypt, and re-reads after invalidation', () => {
    readSecureState()
    writeSecureState({ device: { device_id: 'd2' } as any })
    expect(readSecureState().device?.device_id).toBe('d2')
    expect(decrypt).toHaveBeenCalledTimes(1)
    invalidateSecureState()
    expect(readSecureState().device?.device_id).toBe('d2')
    expect(decrypt).toHaveBeenCalledTimes(2)
  })
})
