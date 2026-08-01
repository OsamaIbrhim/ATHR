/**
 * Standard ATHR request/response header names — API Contract v1.0 §6.
 *
 * WP-003 scope is intentionally narrower than the full §6 header list: only the
 * headers with a concrete consumer in this WP (envelopes, idempotency, optimistic
 * concurrency, request/correlation tracing) are published here. The remaining §6
 * headers (RateLimit-*, Deprecation, Sunset, Link, X-Terminal-Id, ...) are added
 * when the WP that actually implements their behavior lands.
 */

export const REQUEST_ID_HEADER = 'X-Request-Id';
export const CORRELATION_ID_HEADER = 'X-Correlation-Id';
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IF_MATCH_HEADER = 'If-Match';
export const ETAG_HEADER = 'ETag';
export const RETRY_AFTER_HEADER = 'Retry-After';
export const CLIENT_OPERATION_ID_HEADER = 'X-Client-Operation-Id';

export const ATHR_HEADERS = {
  REQUEST_ID: REQUEST_ID_HEADER,
  CORRELATION_ID: CORRELATION_ID_HEADER,
  IDEMPOTENCY_KEY: IDEMPOTENCY_KEY_HEADER,
  IF_MATCH: IF_MATCH_HEADER,
  ETAG: ETAG_HEADER,
  RETRY_AFTER: RETRY_AFTER_HEADER,
  CLIENT_OPERATION_ID: CLIENT_OPERATION_ID_HEADER,
} as const;

export type AthrHeaderName = (typeof ATHR_HEADERS)[keyof typeof ATHR_HEADERS];
