import { describe, expect, it } from 'vitest'
import {
  PosApiPolicyError,
  assertAllowedApiRequest,
} from '../electron/api-policy'

describe('Electron main API policy', () => {
  it('allows only the exact method and POS route combinations', () => {
    expect(
      assertAllowedApiRequest(
        '/products/search?q=shirt',
        'GET',
      ),
    ).toEqual({
      pathname: '/products/search?q=shirt',
      method: 'GET',
    })
    expect(
      assertAllowedApiRequest('/pos/compatibility', 'GET'),
    ).toEqual({
      pathname: '/pos/compatibility',
      method: 'GET',
    })
    expect(
      assertAllowedApiRequest('/pos/sale', 'POST'),
    ).toEqual({
      pathname: '/pos/sale',
      method: 'POST',
    })
  })

  it('blocks external URLs and method escalation', () => {
    expect(() =>
      assertAllowedApiRequest(
        'https://attacker.example/collect',
        'POST',
      ),
    ).toThrow(PosApiPolicyError)
    expect(() =>
      assertAllowedApiRequest('/pos/compatibility', 'POST'),
    ).toThrow(PosApiPolicyError)
    expect(() =>
      assertAllowedApiRequest('/sales/123', 'DELETE'),
    ).toThrow(PosApiPolicyError)
    expect(() =>
      assertAllowedApiRequest(
        '/shifts/123/offline-context',
        'POST',
      ),
    ).toThrow(PosApiPolicyError)
  })

  it.each([
    '/sales/undefined',
    '/sales/null',
    '/sales/%75ndefined',
    '/shifts/undefined/close',
    '/shifts/null/close',
    '/shifts/%20/close',
  ])('blocks an invalid resource path before IPC: %s', (path) => {
    expect(() => assertAllowedApiRequest(path, 'GET')).toThrow(
      PosApiPolicyError,
    )
  })
})
