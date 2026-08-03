/**
 * Identity / Membership / Permission codes — WP-006.
 *
 * Scoped to exactly the failures the new `backend/src/identity/` module can
 * raise: Membership lifecycle (`BR-MEM-*`), the last-owner safeguard
 * (`BR-OWN-100`), Invitations (`BR-INVIT-*`), Access Scope validation
 * (`BR-SCP-101` — empty scope is never implicitly tenant-wide), and
 * TenantContext resolution failures (Multi-tenancy Blueprint §18/§24,
 * `BR-TERR-105` — a context mismatch fails closed, never a partial/guessed
 * result). Support Access grant codes (`BR-SUPA-*`) are included because this
 * WP builds the grant data model/service, even though the support-tooling UI
 * that will be the main consumer is a later WP.
 */

import type { ErrorMetadata } from '../registry';

export const IDENTITY_ERROR_CODES = [
  {
    code: 'MEMBERSHIP_NOT_FOUND',
    category: 'resource_not_found',
    defaultHttpStatus: 404,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'info',
    auditRequired: false,
  },
  {
    // BR-MEM-100: at most one active Membership per (Identity, Tenant) pair.
    code: 'MEMBERSHIP_ALREADY_EXISTS',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    code: 'MEMBERSHIP_INVALID_STATE_TRANSITION',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: false,
  },
  {
    // BR-OWN-100 / ADR-0003 item 4: hard invariant, always audited.
    code: 'LAST_OWNER_SAFEGUARD_VIOLATION',
    category: 'business_rule',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    code: 'INVITATION_NOT_FOUND',
    category: 'resource_not_found',
    defaultHttpStatus: 404,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'info',
    auditRequired: false,
  },
  {
    // BR-INVIT-104: an expired invitation must not be accepted.
    code: 'INVITATION_EXPIRED',
    category: 'precondition',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    code: 'INVITATION_ALREADY_ACCEPTED',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // BR-INVIT-101: single-use token; also covers a revoked/unknown token.
    code: 'INVITATION_TOKEN_INVALID',
    category: 'request_invalid',
    defaultHttpStatus: 400,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // BR-SCP-101: an Access Scope with no explicit value is rejected at
    // write time — never silently interpreted as tenant-wide.
    code: 'ACCESS_SCOPE_REQUIRED',
    category: 'request_invalid',
    defaultHttpStatus: 400,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: false,
  },
  {
    // A non-tenant-wide scope type (location/warehouse/terminal) was
    // submitted without the required scope reference id.
    code: 'ACCESS_SCOPE_REFERENCE_REQUIRED',
    category: 'request_invalid',
    defaultHttpStatus: 400,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: false,
  },
  {
    code: 'SUPPORT_ACCESS_GRANT_NOT_FOUND',
    category: 'resource_not_found',
    defaultHttpStatus: 404,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'info',
    auditRequired: false,
  },
  {
    // BR-SUPA-101 / OD-TEN-008: consent is required by default for any grant
    // beyond metadata-only; break-glass is the sole, higher-audit exception.
    code: 'SUPPORT_ACCESS_CONSENT_REQUIRED',
    category: 'precondition',
    defaultHttpStatus: 409,
    retryable: true,
    retryMode: 'after_approval',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-SUPA-100/104: a grant outside its start/expiry window (or revoked)
    // is unusable; every check against it is audit-relevant.
    code: 'SUPPORT_ACCESS_GRANT_EXPIRED',
    category: 'precondition',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: true,
  },
  {
    // Multi-tenancy Blueprint §18/§24, BR-TERR-105: Tenant context cannot be
    // resolved (no active Membership for the requested tenant) or a resolved
    // resource's tenant does not match the caller's context. Fails closed —
    // never a partial/guessed result. Always audited (cross-tenant probing
    // signal).
    code: 'TENANT_CONTEXT_UNRESOLVABLE',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'never',
    outcome: 'not_applicable',
    severity: 'error',
    auditRequired: true,
  },
  {
    code: 'TENANT_CONTEXT_MISMATCH',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'never',
    outcome: 'not_applicable',
    severity: 'error',
    auditRequired: true,
  },
] as const satisfies readonly ErrorMetadata[];
