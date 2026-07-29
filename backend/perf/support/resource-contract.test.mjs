import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ResourceContractError,
  assertSafeResourcePath,
  buildResourcePath,
  parseJsonResponseBody,
  requireResourceRecord,
  resolveResource,
} from './resource-contract.mjs'

test('an empty HTTP response is represented as null, not a truthy object', () => {
  assert.equal(parseJsonResponseBody(''), null)
})

test('resource records require a non-empty ID', () => {
  for (const value of [
    {},
    { id: undefined },
    { id: null },
    { id: '' },
    { id: '   ' },
    { id: 'undefined' },
    { id: 'null' },
  ]) {
    assert.throws(
      () => requireResourceRecord(value, 'Shift response'),
      ResourceContractError,
    )
  }
})

test('resource paths reject missing IDs before a request can be sent', () => {
  for (const id of [
    undefined,
    null,
    '',
    '  ',
    'undefined',
    'null',
    'not-a-uuid',
  ]) {
    assert.throws(
      () => buildResourcePath('/shifts', id, '/offline-context'),
      ResourceContractError,
    )
  }
  assert.equal(
    buildResourcePath(
      '/shifts',
      '11111111-1111-4111-8111-111111111111',
      '/offline-context',
    ),
    '/shifts/11111111-1111-4111-8111-111111111111/offline-context',
  )
})

test('the request boundary rejects sentinel resource segments', () => {
  for (const path of [
    '/sales/undefined',
    '/sales/null',
    '/sales/%75ndefined',
    '/shifts//close',
    '/shifts/%20/close',
  ]) {
    assert.throws(
      () => assertSafeResourcePath(path),
      ResourceContractError,
    )
  }
  assert.equal(
    assertSafeResourcePath('/products?page=1'),
    '/products?page=1',
  )
})

test('a missing current resource is created and validated', async () => {
  let created = 0
  const resource = await resolveResource(
    async () => null,
    async () => {
      created += 1
      return { id: '11111111-1111-4111-8111-111111111111' }
    },
    'Performance shift',
  )
  assert.equal(created, 1)
  assert.equal(resource.id, '11111111-1111-4111-8111-111111111111')
})

test('an invalid current resource fails without constructing downstream paths', async () => {
  let created = 0
  await assert.rejects(
    resolveResource(
      async () => ({}),
      async () => {
        created += 1
        return { id: '11111111-1111-4111-8111-111111111111' }
      },
      'Performance shift',
    ),
    ResourceContractError,
  )
  assert.equal(created, 0)
})
