import type { DomainFailure, Result } from '@athr/domain-core';
import { AthrDomainError } from '../common/http/athr-exception.filter';
import type { ErrorCode } from '@athr/error-registry';

/** Converts a `Result` failure into the thrown `AthrDomainError` the HTTP layer expects. */
export function unwrapOrThrow<TValue>(result: Result<TValue, DomainFailure>): TValue {
  if (result.ok === false) {
    throw new AthrDomainError(result.failure.code as ErrorCode, result.failure.message);
  }
  return result.value;
}
