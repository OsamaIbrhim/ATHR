import 'reflect-metadata';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import {
  ENVELOPE_KIND_METADATA_KEY,
  Envelope,
  ResponseEnvelopeInterceptor,
} from './response-envelope.interceptor';

function makeContext(kind: string | undefined, request: unknown, response: unknown = {}): ExecutionContext {
  const handler = function handler() {};
  if (kind) Reflect.defineMetadata(ENVELOPE_KIND_METADATA_KEY, kind, handler);
  return {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) } as CallHandler;
}

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor(new Reflector());

  it('passes through unchanged when no @Envelope() decorator is present', async () => {
    const context = makeContext(undefined, { requestId: 'req_1' });
    const result = await firstValueFrom(interceptor.intercept(context, handlerReturning({ raw: true })));
    expect(result).toEqual({ raw: true });
  });

  it('wraps a query handler result in the QueryEnvelope shape', async () => {
    const context = makeContext('query', {
      requestId: 'req_1',
      correlationId: 'corr_1',
      originalUrl: '/api/v1/health/live',
    });
    const result: any = await firstValueFrom(interceptor.intercept(context, handlerReturning({ status: 'ok' })));

    expect(result.data).toEqual({ status: 'ok' });
    expect(result.meta.request_id).toBe('req_1');
    expect(result.meta.correlation_id).toBe('corr_1');
    expect(typeof result.meta.generated_at).toBe('string');
    expect(result.links).toEqual({ self: '/api/v1/health/live' });
  });

  it('wraps a list handler result in the ListEnvelope shape, including a next-cursor link', async () => {
    const context = makeContext('list', { requestId: 'req_1', originalUrl: '/api/v1/things' });
    const page = { limit: 50, next_cursor: 'cur_2', previous_cursor: null, has_more: true };
    const result: any = await firstValueFrom(
      interceptor.intercept(context, handlerReturning({ items: [{ id: 1 }], page })),
    );

    expect(result.data).toEqual([{ id: 1 }]);
    expect(result.page).toEqual(page);
    expect(result.meta.request_id).toBe('req_1');
    expect(typeof result.meta.generated_at).toBe('string');
    expect(result.links.self).toBe('/api/v1/things');
    expect(result.links.next).toContain('/api/v1/things?');
    expect(result.links.next).toContain('cur_2');
  });

  it('sets links.next to null when the list has no further page', async () => {
    const context = makeContext('list', { requestId: 'req_1', originalUrl: '/api/v1/things' });
    const page = { limit: 50, next_cursor: null, previous_cursor: null, has_more: false };
    const result: any = await firstValueFrom(
      interceptor.intercept(context, handlerReturning({ items: [], page })),
    );

    expect(result.links.next).toBeNull();
  });

  it('wraps a command handler result in the succeeded CommandSuccessEnvelope shape', async () => {
    const context = makeContext('command', { requestId: 'req_1', correlationId: 'corr_1' }, { statusCode: 200 });
    const result: any = await firstValueFrom(interceptor.intercept(context, handlerReturning({ id: 'sale_1' })));

    expect(result.data.resource).toEqual({ id: 'sale_1' });
    expect(result.data.command.status).toBe('succeeded');
    expect(result.data.command.command_id).toMatch(/^cmd_/);
    expect(result.meta).toEqual({ request_id: 'req_1', correlation_id: 'corr_1' });
  });

  it('wraps an accepted (202) command handler result in the CommandAcceptedEnvelope shape', async () => {
    const context = makeContext('command', { requestId: 'req_1' }, { statusCode: 202 });
    const result: any = await firstValueFrom(
      interceptor.intercept(
        context,
        handlerReturning({ operation_id: 'op_1', status_url: '/api/v1/operations/op_1' }),
      ),
    );

    expect(result).toEqual({
      data: { operation_id: 'op_1', status: 'accepted', status_url: '/api/v1/operations/op_1' },
      meta: { request_id: 'req_1' },
    });
  });

  it('always carries a non-empty meta.request_id, generating one if the request has none', async () => {
    const context = makeContext('query', {});
    const result: any = await firstValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(typeof result.meta.request_id).toBe('string');
    expect(result.meta.request_id.length).toBeGreaterThan(0);
  });

  it('exposes an Envelope() decorator that sets the expected reflection metadata', () => {
    class Fixture {
      @Envelope('query')
      handler() {
        return undefined;
      }
    }

    expect(Reflect.getMetadata(ENVELOPE_KIND_METADATA_KEY, Fixture.prototype.handler)).toBe('query');
  });
});
