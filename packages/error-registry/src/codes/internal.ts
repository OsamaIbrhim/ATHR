/**
 * Generic internal-failure codes — Error Catalog v1.0 §24.
 *
 * `INTERNAL_ERROR` is the `AthrExceptionFilter` fallback for any exception
 * that isn't a recognized domain/application failure (Error Catalog principle
 * #20: "an unexpected exception becomes a safe internal error with a support
 * reference"). `UNEXPECTED_PROCESSING_ERROR` is available for application code
 * that wants to signal "something went wrong mid-processing" without claiming
 * a more specific domain code exists yet.
 */

import type { ErrorMetadata } from '../registry';

export const INTERNAL_ERROR_CODES = [
  {
    code: 'INTERNAL_ERROR',
    category: 'internal',
    defaultHttpStatus: 500,
    retryable: false,
    retryMode: 'manual_review_only',
    outcome: 'unknown',
    severity: 'critical',
    auditRequired: false,
  },
  {
    code: 'UNEXPECTED_PROCESSING_ERROR',
    category: 'internal',
    defaultHttpStatus: 500,
    retryable: false,
    retryMode: 'manual_review_only',
    outcome: 'unknown',
    severity: 'critical',
    auditRequired: false,
  },
] as const satisfies readonly ErrorMetadata[];
