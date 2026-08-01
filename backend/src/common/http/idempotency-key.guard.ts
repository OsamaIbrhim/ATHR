import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IDEMPOTENCY_KEY_HEADER } from '@athr/contracts';
import { AthrDomainError } from './athr-exception.filter';

export const REQUIRES_IDEMPOTENCY_KEY_METADATA_KEY = 'athr:requires-idempotency-key';
export const RequiresIdempotencyKey = (): MethodDecorator =>
  SetMetadata(REQUIRES_IDEMPOTENCY_KEY_METADATA_KEY, true);

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9._-]{8,200}$/;
const IDEMPOTENCY_KEY_HEADER_NAME = IDEMPOTENCY_KEY_HEADER.toLowerCase();

/**
 * Skeleton per API Contract §19–§22 / Error Catalog §37. Only validates that a
 * well-formed `Idempotency-Key` header is present on routes that opt in via
 * `@RequiresIdempotencyKey()`. It does not look up or persist the stored-result
 * record shape from API Contract §21 (tenant + principal + route + payload-hash
 * → stored HTTP status/body/resource ids), because no domain module calls a
 * route that declares this decorator yet.
 *
 * TODO(WP-010): wire real idempotency storage — look up a stored result for a
 * reused key+payload, persist a new record on first use, and enforce
 * IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD — once the first real command
 * endpoint needs it.
 */
@Injectable()
export class IdempotencyKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresKey = this.reflector.get<boolean | undefined>(
      REQUIRES_IDEMPOTENCY_KEY_METADATA_KEY,
      context.getHandler(),
    );
    if (!requiresKey) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.headers[IDEMPOTENCY_KEY_HEADER_NAME];
    const key = Array.isArray(supplied) ? supplied[0] : supplied;

    if (!key) {
      throw new AthrDomainError('IDEMPOTENCY_KEY_REQUIRED', `${IDEMPOTENCY_KEY_HEADER} header is required for this operation.`);
    }
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new AthrDomainError(
        'IDEMPOTENCY_KEY_FORMAT_INVALID',
        `${IDEMPOTENCY_KEY_HEADER} must be 8-200 characters of letters, digits, '.', '_' or '-'.`,
      );
    }

    return true;
  }
}

export const REQUIRES_EXPECTED_VERSION_METADATA_KEY = 'athr:requires-expected-version';
export const RequiresExpectedVersion = (): MethodDecorator =>
  SetMetadata(REQUIRES_EXPECTED_VERSION_METADATA_KEY, true);

/**
 * Stub only — optimistic concurrency per API Contract §23–§25 / Error Catalog
 * §38 (`If-Match` / `EXPECTED_VERSION_MISMATCH`). Real enforcement starts once
 * an Aggregate carries a version field to compare against (WP-005+); until
 * then this guard always allows the request through, even on routes that opt
 * in via `@RequiresExpectedVersion()`.
 *
 * TODO(WP-005+): read `If-Match`, load the Aggregate's current version, and
 * throw a registered `EXPECTED_VERSION_MISMATCH` (412) on a stale write.
 */
@Injectable()
export class ExpectedVersionGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
