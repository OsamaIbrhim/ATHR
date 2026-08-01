/** Error categories — Error Catalog v1.0 §5. Exhaustive; do not add speculative categories here. */
export const ERROR_CATEGORIES = [
  'request_invalid',
  'authentication',
  'authorization',
  'resource_not_found',
  'state_conflict',
  'business_rule',
  'precondition',
  'concurrency',
  'idempotency',
  'entitlement',
  'limit',
  'rate_limit',
  'dependency',
  'provider',
  'temporarily_unavailable',
  'outcome_unknown',
  'partial_completion',
  'manual_intervention',
  'data_integrity',
  'internal',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
