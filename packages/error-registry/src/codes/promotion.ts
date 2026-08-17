/**
 * Promotion/Coupon/Bundle codes — WP-008 Phase D (Promotions, Coupons,
 * Bundles MVP, BR §20-25).
 *
 * `RESOURCE_NOT_FOUND` (auth.ts) already covers every "not found or not in
 * this tenant" case for `Promotion`/`Coupon`/`Bundle`, matching every prior
 * phase's precedent — nothing new is registered for that. The codes below are
 * for the BR §20-25 invariants specific to this phase.
 */

import type { ErrorMetadata } from '../registry';

export const PROMOTION_ERROR_CODES = [
  {
    // BR-PMT-100: draft -> scheduled -> active -> paused/ended -> ... is a
    // strict sequence; `submitted_by/at` + `approved_by/at` must both be set
    // before `schedule()` moves a draft forward (see the schema's
    // `PromotionStatus` comment for why there is no visible "submitted"/
    // "approved" state).
    code: 'PROMOTION_INVALID_TRANSITION',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // Permission Matrix §19: the actor who submitted a Promotion cannot also
    // approve it — same separation `TAX_CODE_SELF_APPROVAL_FORBIDDEN` and
    // `PriceBookService`'s maker-checker enforce.
    code: 'PROMOTION_SELF_APPROVAL_FORBIDDEN',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // OD-CAT-012 / BR-BEN-104: a Promotion cannot activate without a declared
    // `return_policy` — see the schema's `PromotionReturnPolicy` comment.
    code: 'PROMOTION_RETURN_POLICY_REQUIRED',
    category: 'precondition',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-CERR-202: logged when promotion evaluation throws mid-quote.
    // `PromotionEvaluationService.evaluate` catches this internally and never
    // lets it propagate — the base price is always returned — but the
    // failure is still recorded (audit + structured log), never swallowed
    // silently per CLAUDE.md §4.3. Never thrown across an HTTP boundary, so
    // `defaultHttpStatus` is nominal (the exception filter never sees this
    // code) — kept accurate (500-class) for log/audit consumers only.
    code: 'PROMOTION_EVALUATION_FAILED',
    category: 'internal',
    defaultHttpStatus: 500,
    retryable: true,
    retryMode: 'after_dependency_recovery',
    outcome: 'no_effect',
    severity: 'warning',
    auditRequired: true,
  },
  {
    // BR-CPN-206: coupon codes never appear in plaintext in an error message
    // or log — this code's message never echoes the submitted code back, only
    // the coupon id once resolved (see `CouponService`/`CouponRepository`).
    code: 'COUPON_INVALID_OR_EXPIRED',
    category: 'business_rule',
    defaultHttpStatus: 422,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-CPN-205: total/per-customer usage caps are centralized on the
    // `Coupon` row itself, never cache-only. Matrix §19 `coupon.redemption.
    // override` is the sanctioned retry path for a supervisor, hence
    // `after_approval` rather than `never`.
    code: 'COUPON_USAGE_LIMIT_EXCEEDED',
    category: 'limit',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'after_approval',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-BND-105 / OD-CAT-012 analogue for Bundle: `BundleService.activate`
    // rejects a null `return_policy`.
    code: 'BUNDLE_RETURN_POLICY_REQUIRED',
    category: 'precondition',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // BR-BND-101: a Bundle's component list is fixed once it leaves `draft`
    // — mutating components requires a new version (`supersede`), mirroring
    // `TaxCode`.
    code: 'BUNDLE_NOT_DRAFT',
    category: 'state_conflict',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'never',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
  {
    // A Bundle with zero components is not a bundle — `BundleService.activate`
    // rejects it rather than shipping a benefit that resolves to nothing.
    code: 'BUNDLE_EMPTY',
    category: 'precondition',
    defaultHttpStatus: 409,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: true,
  },
] as const satisfies readonly ErrorMetadata[];
