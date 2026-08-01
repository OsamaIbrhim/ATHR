/**
 * Authentication/authorization codes — Error Catalog v1.0 §34–§36.
 *
 * Scoped to exactly the codes that map to the Backend's current JWT guard
 * behavior (`JwtAuthGuard`, `RolesGuard`): missing/invalid/expired bearer
 * token, revoked session, permission denial, and the §36 not-found
 * concealment code. The rest of §34–§36 (MFA, step-up, support grants,
 * separation-of-duties) has no guard implementation yet and is added when
 * that behavior lands.
 */

import type { ErrorMetadata } from '../registry';

export const AUTH_ERROR_CODES = [
  {
    code: 'AUTHENTICATION_REQUIRED',
    category: 'authentication',
    defaultHttpStatus: 401,
    retryable: false,
    retryMode: 'after_reauthentication',
    outcome: 'not_applicable',
    severity: 'error',
    auditRequired: false,
  },
  {
    code: 'ACCESS_TOKEN_INVALID',
    category: 'authentication',
    defaultHttpStatus: 401,
    retryable: false,
    retryMode: 'after_reauthentication',
    outcome: 'not_applicable',
    severity: 'error',
    auditRequired: false,
  },
  {
    code: 'ACCESS_TOKEN_EXPIRED',
    category: 'authentication',
    defaultHttpStatus: 401,
    retryable: false,
    retryMode: 'after_reauthentication',
    outcome: 'not_applicable',
    severity: 'error',
    auditRequired: false,
  },
  {
    code: 'SESSION_REVOKED',
    category: 'authentication',
    defaultHttpStatus: 401,
    retryable: false,
    retryMode: 'after_reauthentication',
    outcome: 'not_applicable',
    severity: 'warning',
    auditRequired: false,
  },
  {
    // Error Catalog §92: authorization denials are always-audit.
    code: 'PERMISSION_DENIED',
    category: 'authorization',
    defaultHttpStatus: 403,
    retryable: false,
    retryMode: 'never',
    outcome: 'not_applicable',
    severity: 'error',
    auditRequired: true,
  },
  {
    // Error Catalog §36 concealment: cross-tenant/out-of-scope resources
    // return this instead of a distinguishing 403/404.
    code: 'RESOURCE_NOT_FOUND',
    category: 'resource_not_found',
    defaultHttpStatus: 404,
    retryable: false,
    retryMode: 'never',
    outcome: 'not_applicable',
    severity: 'info',
    auditRequired: false,
  },
] as const satisfies readonly ErrorMetadata[];
