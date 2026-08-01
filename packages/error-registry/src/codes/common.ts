/**
 * Common request/schema/query codes — Error Catalog v1.0 §31 and §33.
 *
 * §32 (Money/Quantity/Date wire-format codes) is deliberately excluded: no
 * Money/Quantity validation logic exists in the Backend yet (that lands in
 * WP-004), so those codes are not reachable today. Add them when the value
 * objects that can actually raise them exist.
 */

import type { ErrorMetadata } from '../registry';

// No explicit return-type annotation: keeping this inferred + `as const`
// preserves each call site's literal `code`, which is what lets `ErrorCode`
// in registry.ts be a real string-literal union instead of widening to `string`.
function requestInvalid<TCode extends string>(code: TCode, defaultHttpStatus: number) {
  return {
    code,
    category: 'request_invalid',
    defaultHttpStatus,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: false,
  } as const;
}

export const COMMON_ERROR_CODES = [
  // §37 — Idempotency Codes. Included here (rather than a dedicated file, not
  // part of this WP's file list) because `IdempotencyKeyGuard` — the one real
  // consumer added by this WP — needs a registered code to throw.
  {
    code: 'IDEMPOTENCY_KEY_REQUIRED',
    category: 'idempotency',
    defaultHttpStatus: 428, // Error Catalog §22
    retryable: true,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: false,
  },
  {
    code: 'IDEMPOTENCY_KEY_FORMAT_INVALID',
    category: 'idempotency',
    defaultHttpStatus: 400,
    retryable: false,
    retryMode: 'after_user_action',
    outcome: 'no_effect',
    severity: 'error',
    auditRequired: false,
  },
  // §31 — Syntax and Schema Codes
  requestInvalid('REQUEST_BODY_MALFORMED', 400),
  requestInvalid('REQUEST_BODY_REQUIRED', 400),
  requestInvalid('REQUEST_HEADER_REQUIRED', 400),
  requestInvalid('REQUEST_FIELD_REQUIRED', 400),
  requestInvalid('REQUEST_FIELD_UNKNOWN', 400),
  requestInvalid('REQUEST_FIELD_TYPE_INVALID', 400),
  requestInvalid('REQUEST_FIELD_FORMAT_INVALID', 400),
  requestInvalid('REQUEST_FIELD_VALUE_INVALID', 400),
  requestInvalid('REQUEST_ARRAY_EMPTY', 400),
  requestInvalid('REQUEST_ARRAY_TOO_LARGE', 400),
  requestInvalid('REQUEST_OBJECT_TOO_DEEP', 400),
  requestInvalid('REQUEST_BODY_TOO_LARGE', 413), // Error Catalog §18
  requestInvalid('CONTENT_TYPE_NOT_SUPPORTED', 415), // Error Catalog §19
  requestInvalid('RESPONSE_FORMAT_NOT_SUPPORTED', 406), // Error Catalog §14
  requestInvalid('HTTP_METHOD_NOT_ALLOWED', 405), // Error Catalog §13
  // §33 — Query Codes
  requestInvalid('PAGINATION_LIMIT_INVALID', 400),
  requestInvalid('PAGINATION_LIMIT_EXCEEDED', 400),
  requestInvalid('CURSOR_FORMAT_INVALID', 400),
  requestInvalid('CURSOR_EXPIRED', 400),
  requestInvalid('CURSOR_SCOPE_MISMATCH', 400),
  requestInvalid('CURSOR_FILTER_MISMATCH', 400),
  requestInvalid('FILTER_NOT_SUPPORTED', 400),
  requestInvalid('FILTER_VALUE_INVALID', 400),
  requestInvalid('SORT_NOT_SUPPORTED', 400),
  requestInvalid('SORT_FIELD_LIMIT_EXCEEDED', 400),
  requestInvalid('SEARCH_QUERY_TOO_SHORT', 400),
  requestInvalid('SEARCH_QUERY_INVALID', 400),
  requestInvalid('INCLUDE_NOT_SUPPORTED', 400),
  requestInvalid('INCLUDE_DEPTH_EXCEEDED', 400),
  requestInvalid('FIELD_SELECTION_INVALID', 400),
  requestInvalid('TOTAL_COUNT_NOT_AVAILABLE', 400),
] as const satisfies readonly ErrorMetadata[];
