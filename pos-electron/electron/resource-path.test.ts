import { describe, expect, it } from 'vitest'
import {
  ResourcePathError,
  assertSafeResourcePath,
  buildResourcePath,
  requireResourceId,
} from './resource-path'

describe('POS resource path boundary', () => {
  it.each([
    undefined,
    null,
    '',
    ' ',
    'undefined',
    'null',
    'not-a-uuid',
  ])('rejects an invalid resource ID: %p', (value) => {
    expect(() => requireResourceId(value)).toThrow(ResourcePathError)
  })

  it.each([
    '/sales/undefined',
    '/sales/null',
    '/sales/%75ndefined',
    '/shifts//close',
    '/shifts/%20/close',
  ])('rejects an unsafe resource path: %s', (path) => {
    expect(() => assertSafeResourcePath(path)).toThrow(ResourcePathError)
  })

  it('builds a path only after validating the resource ID', () => {
    expect(
      buildResourcePath(
        '/shifts',
        '11111111-1111-4111-8111-111111111111',
        '/offline-context',
      ),
    ).toBe(
      '/shifts/11111111-1111-4111-8111-111111111111/offline-context',
    )
  })
})
