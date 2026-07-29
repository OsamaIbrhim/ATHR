import { requireResourceRecord } from './resource-contract.mjs'

export function requireSaleAcknowledgement(
  response,
  expectedSyncId,
  label = 'Sale acknowledgement',
) {
  const acknowledgement = requireResourceRecord(response, label)
  if (acknowledgement.sync_id !== expectedSyncId) {
    throw new Error(
      `${label} sync ID does not match the submitted sale command`,
    )
  }
  return acknowledgement
}

export function requireIdempotentReplay(original, replay) {
  if (
    original.id !== replay.id ||
    original.sync_id !== replay.sync_id
  ) {
    throw new Error(
      'Sale replay must acknowledge the same persisted invoice',
    )
  }
}
