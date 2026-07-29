import { describe, expect, it } from 'vitest'
import {
  ResourcePathError,
  assertSafeApiPath,
} from './resource-path'

describe('Admin API resource path boundary', () => {
  it.each([
    '/sales/undefined',
    '/sales/null',
    '/sales/%75ndefined',
    '/shifts//close',
    '/shifts/%20/close',
  ])('rejects an invalid resource path: %s', (path) => {
    expect(() => assertSafeApiPath(path)).toThrow(ResourcePathError)
  })

  it('preserves valid paths and query strings', () => {
    expect(
      assertSafeApiPath(
        '/sales/11111111-1111-4111-8111-111111111111?view=full',
      ),
    ).toBe(
      '/sales/11111111-1111-4111-8111-111111111111?view=full',
    )
  })
})
