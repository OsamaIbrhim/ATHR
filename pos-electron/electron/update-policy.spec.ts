import { describe, expect, it } from 'vitest'
import { compareVersions, selectUpdate } from './update-policy'

describe('POS update policy', () => {
  it('compares stable semantic versions', () => {
    expect(compareVersions('1.3.1', '1.3.0')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.3.0')).toBe(0)
    expect(compareVersions('1.3.0-beta.2', '1.3.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.3.0-beta.2')).toBeGreaterThan(0)
  })

  it('accepts only a newer HTTPS release with a SHA-256', () => {
    expect(
      selectUpdate(
        {
          available: true,
          version: '1.4.0',
          url: 'https://downloads.example.com/Bold-POS.exe',
          sha256: 'a'.repeat(64),
          notes: 'Update',
          mandatory: false,
        },
        '1.3.0',
      ),
    ).toMatchObject({ version: '1.4.0' })

    expect(
      selectUpdate(
        {
          available: true,
          version: '1.3.0',
          url: 'https://downloads.example.com/Bold-POS.exe',
          sha256: 'a'.repeat(64),
        },
        '1.3.0',
      ),
    ).toBeNull()
  })

  it('rejects downgrade, HTTP, and malformed checksum manifests', () => {
    expect(() =>
      selectUpdate(
        {
          available: true,
          version: '1.4.0',
          url: 'http://downloads.example.com/Bold-POS.exe',
          sha256: 'not-a-checksum',
        },
        '1.3.0',
      ),
    ).toThrow('Invalid POS update manifest')
  })
})
