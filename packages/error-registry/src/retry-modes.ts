/** Retry modes — Error Catalog v1.0 §7. Exhaustive. */
export const RETRY_MODES = [
  'never',
  'same_request_immediately',
  'same_idempotency_key_after_delay',
  'after_refresh',
  'after_reauthentication',
  'after_step_up',
  'after_approval',
  'after_user_action',
  'after_dependency_recovery',
  'manual_review_only',
  'poll_operation',
] as const;

export type RetryMode = (typeof RETRY_MODES)[number];
