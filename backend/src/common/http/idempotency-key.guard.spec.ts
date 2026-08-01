import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AthrDomainError } from './athr-exception.filter';
import {
  ExpectedVersionGuard,
  IdempotencyKeyGuard,
  REQUIRES_IDEMPOTENCY_KEY_METADATA_KEY,
  RequiresIdempotencyKey,
} from './idempotency-key.guard';

// A synthetic route (no real controller wires this decorator yet — see the
// TODO(WP-010) in idempotency-key.guard.ts) so the guard's behavior is
// proven even though it has no current production consumer.
function makeSyntheticRouteContext(requiresKey: boolean, headers: Record<string, string>): ExecutionContext {
  const handler = function syntheticHandler() {};
  if (requiresKey) Reflect.defineMetadata(REQUIRES_IDEMPOTENCY_KEY_METADATA_KEY, true, handler);
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('IdempotencyKeyGuard', () => {
  const guard = new IdempotencyKeyGuard(new Reflector());

  it('allows a synthetic route without @RequiresIdempotencyKey() regardless of headers', () => {
    expect(guard.canActivate(makeSyntheticRouteContext(false, {}))).toBe(true);
  });

  it('rejects a synthetic @RequiresIdempotencyKey() route with a missing Idempotency-Key header', () => {
    let thrown: unknown;
    try {
      guard.canActivate(makeSyntheticRouteContext(true, {}));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AthrDomainError);
    expect((thrown as AthrDomainError).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects a malformed Idempotency-Key header', () => {
    let thrown: unknown;
    try {
      guard.canActivate(makeSyntheticRouteContext(true, { 'idempotency-key': '###' }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AthrDomainError);
    expect((thrown as AthrDomainError).code).toBe('IDEMPOTENCY_KEY_FORMAT_INVALID');
  });

  it('allows a synthetic route with a well-formed Idempotency-Key header', () => {
    expect(
      guard.canActivate(makeSyntheticRouteContext(true, { 'idempotency-key': 'a-valid-key-12345' })),
    ).toBe(true);
  });

  it('exposes a RequiresIdempotencyKey() decorator that sets the expected reflection metadata', () => {
    class Fixture {
      @RequiresIdempotencyKey()
      handler() {
        return undefined;
      }
    }

    expect(Reflect.getMetadata(REQUIRES_IDEMPOTENCY_KEY_METADATA_KEY, Fixture.prototype.handler)).toBe(true);
  });
});

describe('ExpectedVersionGuard (WP-005+ stub)', () => {
  it('always allows the request through until real Aggregate versions exist', () => {
    const guard = new ExpectedVersionGuard();
    expect(guard.canActivate({} as ExecutionContext)).toBe(true);
  });
});
