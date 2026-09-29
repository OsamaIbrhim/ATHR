import { describe, expect, it } from 'vitest'
import {
  assertPosCompatibility,
  PosCompatibilityError,
} from './pos-compatibility'

const compatible = {
  api_protocol: { minimum: 2, maximum: 3 },
  minimum_pos_version: '1.4.0',
  backend_version: '1.8.0',
  deployment_sha: 'abc123',
}

describe('POS/backend compatibility', () => {
  it('accepts a matching protocol and application version', () => {
    expect(
      assertPosCompatibility(compatible, '1.4.0'),
    ).toEqual({
      protocol: 3,
      backendVersion: '1.8.0',
      deploymentSha: 'abc123',
      minimumPosVersion: '1.4.0',
    })
  })

  it('blocks a backend that supports only a newer protocol', () => {
    expect(() =>
      assertPosCompatibility(
        {
          ...compatible,
          api_protocol: { minimum: 4, maximum: 4 },
        },
        '1.4.0',
      ),
    ).toThrowError(PosCompatibilityError)
  })

  it('blocks a POS application older than the server minimum', () => {
    expect(() =>
      assertPosCompatibility(
        {
          ...compatible,
          minimum_pos_version: '1.4.0',
        },
        '1.3.4',
      ),
    ).toThrow('أقدم من الحد الأدنى')
  })

  it('blocks a backend that no longer supports this protocol', () => {
    expect(() =>
      assertPosCompatibility(
        { ...compatible, api_protocol: { minimum: 2, maximum: 2 } },
        '1.6.0',
      ),
    ).toThrowError(PosCompatibilityError)
  })

  it('fails closed for a malformed response', () => {
    expect(() =>
      assertPosCompatibility(
        { api_protocol: { minimum: 1 } },
        '1.4.0',
      ),
    ).toThrow('بيانات توافق غير مكتملة')
  })
})
