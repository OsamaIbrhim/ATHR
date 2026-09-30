/**
 * Subscription / entitlement / limit codes (ADR-0005: Permission ∩ Entitlement ∩ Limit).
 * Owned by `backend/src/entitlements/`.
 */

import type { ErrorMetadata } from '../registry';

export const ENTITLEMENT_ERROR_CODES = [
  {
    // The tenant's plan does not include the feature the endpoint needs.
    code: 'ENTITLEMENT_FEATURE_NOT_IN_PLAN',
    category: 'entitlement',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // Creating one more resource would exceed the plan limit. Existing data is never touched.
    code: 'ENTITLEMENT_LIMIT_REACHED',
    category: 'limit',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // Subscription ended (past the grace period): reads only.
    code: 'TENANT_READ_ONLY',
    category: 'entitlement',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // Subscription suspended/cancelled (or missing): only auth and subscription status work.
    code: 'TENANT_SUSPENDED',
    category: 'entitlement',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    code: 'PLAN_IN_USE',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    code: 'SIGNUP_RATE_LIMITED',
    category: 'rate_limit',
    defaultHttpStatus: 429,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
] as const satisfies readonly ErrorMetadata[];
