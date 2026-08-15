/**
 * Tax codes — WP-008 Phase C (Versioned Tax Codes, BR §17 / BR-TAX-2xx).
 *
 * `RESOURCE_NOT_FOUND` (auth.ts) already covers every "not found or not in
 * this tenant" case for `TaxCategory`/`TaxCode`/`TaxExemption`, matching the
 * Phase A/B precedent — nothing new is registered for that. The codes below
 * are for the BR §17 invariants specific to this phase.
 */

import type { ErrorMetadata } from '../registry';

export const TAX_ERROR_CODES = [
  {
    // BR-TAX-201: a variant resolves to a tax category, and that category must
    // have an active TaxCode. No active code blocks the sale — it is never a
    // silent zero-rated line, for the same reason BR-PSL-101 makes a missing
    // price block rather than fall back.
    code: 'TAX_NO_ACTIVE_CODE',
    category: 'business_rule',
    defaultHttpStatus: 422,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-TAX-200/203: draft -> submitted -> approved -> scheduled -> active ->
    // superseded is a strict sequence; an active version's rate is immutable.
    code: 'TAX_CODE_INVALID_TRANSITION',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // Permission Matrix §18: tax rule activation is H/A2/P2 — the submitter of
    // a version cannot also approve it.
    code: 'TAX_CODE_SELF_APPROVAL_FORBIDDEN',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-TAX-205: an exemption without recorded evidence is not an exemption.
    code: 'TAX_EXEMPTION_EVIDENCE_REQUIRED',
    category: 'request_invalid',
    defaultHttpStatus: 400,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-TAX-205: applying an exemption that is pending, expired, revoked or
    // belongs to another customer/category must not zero-rate a line.
    code: 'TAX_EXEMPTION_NOT_APPLICABLE',
    category: 'business_rule',
    defaultHttpStatus: 422,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-TAX-206 / Matrix §18: manual tax override is forbidden by default and
    // may be disabled entirely per jurisdiction. Correction is by changing tax
    // eligibility or issuing an authorised corrective document — never a free
    // tax amount ("لا مبلغ ضريبة حر").
    code: 'TAX_MANUAL_OVERRIDE_FORBIDDEN',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-TAX-204: a price context must declare inclusive or exclusive. A line
    // whose price context has no declared mode cannot be taxed at all —
    // "لا يمكن لنفس السعر أن يكون شاملًا وغير شامل دون Scope صريحة".
    code: 'TAX_MODE_NOT_DECLARED',
    category: 'business_rule',
    defaultHttpStatus: 422,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
] as const satisfies readonly ErrorMetadata[];
