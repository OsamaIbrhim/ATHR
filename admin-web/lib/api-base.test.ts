import { describe, expect, it } from 'vitest'
import {
  AdminApiConfigurationError,
  resolveAdminApiBase,
} from './api-base'

describe('ATHR Admin API configuration', () => {
  it('requires explicit HTTPS configuration at production runtime', () => {
    expect(() =>
      resolveAdminApiBase({ NODE_ENV: 'production' }),
    ).toThrow(AdminApiConfigurationError)
    expect(() =>
      resolveAdminApiBase({
        NODE_ENV: 'production',
        ATHR_API_INTERNAL_BASE: 'http://api.example.com/api/v1',
      }),
    ).toThrow('HTTPS')
  })

  it('normalizes an explicit ATHR API endpoint', () => {
    expect(
      resolveAdminApiBase({
        NODE_ENV: 'production',
        ATHR_API_INTERNAL_BASE: 'https://api.example.com/api/v1/',
      }),
    ).toBe('https://api.example.com/api/v1')
  })

  it('allows production-mode loopback HTTP only for same-runner E2E', () => {
    expect(
      resolveAdminApiBase({
        NODE_ENV: 'production',
        ATHR_API_INTERNAL_BASE: 'http://127.0.0.1:3000/api/v1',
      }),
    ).toBe('http://127.0.0.1:3000/api/v1')
    expect(() =>
      resolveAdminApiBase({
        NODE_ENV: 'production',
        ATHR_API_INTERNAL_BASE: 'http://10.0.0.8:3000/api/v1',
      }),
    ).toThrow('HTTPS')
  })

  it('does not accept credentials or an incorrect API path', () => {
    for (const value of [
      'https://user:pass@api.example.com/api/v1',
      'https://api.example.com/api/v2',
    ]) {
      expect(() =>
        resolveAdminApiBase({
          NODE_ENV: 'production',
          ATHR_API_INTERNAL_BASE: value,
        }),
      ).toThrow(AdminApiConfigurationError)
    }
  })
})
