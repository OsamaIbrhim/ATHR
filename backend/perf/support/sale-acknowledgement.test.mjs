import assert from 'node:assert/strict'
import test from 'node:test'
import {
  requireIdempotentReplay,
  requireSaleAcknowledgement,
} from './sale-acknowledgement.mjs'

const acknowledgement = {
  id: '11111111-1111-4111-8111-111111111111',
  sync_id: '22222222-2222-4222-8222-222222222222',
}

test('sale acknowledgements bind the HTTP response to the submitted sync ID', () => {
  assert.equal(
    requireSaleAcknowledgement(
      acknowledgement,
      acknowledgement.sync_id,
    ),
    acknowledgement,
  )
  assert.throws(() =>
    requireSaleAcknowledgement(
      acknowledgement,
      '33333333-3333-4333-8333-333333333333',
    ),
  )
})

test('sale acknowledgements reject missing persisted resource IDs', () => {
  assert.throws(() =>
    requireSaleAcknowledgement(
      { sync_id: acknowledgement.sync_id },
      acknowledgement.sync_id,
    ),
  )
})

test('idempotent replay must return the same invoice and sync ID', () => {
  assert.doesNotThrow(() =>
    requireIdempotentReplay(acknowledgement, { ...acknowledgement }),
  )
  assert.throws(() =>
    requireIdempotentReplay(acknowledgement, {
      ...acknowledgement,
      id: '44444444-4444-4444-8444-444444444444',
    }),
  )
})
