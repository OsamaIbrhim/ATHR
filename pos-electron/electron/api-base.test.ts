import { describe, expect, it } from 'vitest'
import {
  ApiConfigurationError,
  normalizeApiBase,
  resolveApiBase,
} from './api-base'

describe('ATHR API base configuration', () => {
  it('requires explicit configuration in packaged builds', () => {
    expect(() =>
      resolveApiBase({ packaged: true }),
    ).toThrow(ApiConfigurationError)
  })

  it('normalizes an explicitly configured HTTPS API', () => {
    expect(
      resolveApiBase({
        environmentValue: ' https://api.athr.example/api/v1/ ',
        packaged: true,
      }),
    ).toEqual({
      apiBase: 'https://api.athr.example/api/v1',
      source: 'environment',
      locked: true,
    })
  })

  it('rejects insecure remote production endpoints', () => {
    expect(() =>
      normalizeApiBase('http://api.athr.example/api/v1', {
        packaged: true,
      }),
    ).toThrow('HTTPS')
  })

  it('rejects credentials, query strings, fragments and wrong API paths', () => {
    for (const value of [
      'https://user:pass@api.athr.example/api/v1',
      'https://api.athr.example/api/v1?tenant=x',
      'https://api.athr.example/api/v1#x',
      'https://api.athr.example/api/v2',
    ]) {
      expect(() => normalizeApiBase(value, { packaged: true })).toThrow(
        ApiConfigurationError,
      )
    }
  })

  it('uses localhost only for development', () => {
    expect(resolveApiBase({ packaged: false })).toMatchObject({
      apiBase: 'http://localhost:3000/api/v1',
      source: 'development',
    })
  })
})
