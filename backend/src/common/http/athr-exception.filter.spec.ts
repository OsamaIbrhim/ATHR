import 'reflect-metadata';
import { ArgumentsHost, HttpException, NotFoundException } from '@nestjs/common';
import { AthrDomainError, AthrExceptionFilter } from './athr-exception.filter';

function makeHost(request: unknown, response: unknown): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe('AthrExceptionFilter', () => {
  const filter = new AthrExceptionFilter();

  it('maps an unhandled exception to a safe 500 INTERNAL_ERROR envelope with no stack trace', () => {
    const request = { method: 'GET', originalUrl: '/api/v1/whatever', requestId: 'req_1', correlationId: 'corr_1' };
    const response = makeResponse();

    filter.catch(new Error('column "secret" does not exist in table users'), makeHost(request, response));

    expect(response.statusCode).toBe(500);
    const body = response.body as any;
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toMatch(/secret|column|table/i);
    expect(JSON.stringify(body)).not.toMatch(/at Object|\.ts:\d+|\.js:\d+/);
    expect(body.meta.request_id).toBe('req_1');
    expect(body.meta.correlation_id).toBe('corr_1');
    expect(typeof body.meta.occurred_at).toBe('string');
  });

  it('maps a deliberately-thrown known domain error to its registered HTTP status + code', () => {
    const request = { method: 'POST', originalUrl: '/api/v1/x', requestId: 'req_2', correlationId: 'corr_2' };
    const response = makeResponse();

    filter.catch(new AthrDomainError('PERMISSION_DENIED', 'Not allowed.'), makeHost(request, response));

    expect(response.statusCode).toBe(403);
    const body = response.body as any;
    expect(body.error.code).toBe('PERMISSION_DENIED');
    expect(body.error.category).toBe('authorization');
    expect(body.error.retry_mode).toBe('never');
    expect(body.error.outcome).toBe('not_applicable');
    expect(body.error.message).toBe('Not allowed.');
  });

  it('honors AthrDomainError overrides (state/version/required_action)', () => {
    const request = { method: 'POST', originalUrl: '/api/v1/x', requestId: 'req_2b', correlationId: 'corr_2b' };
    const response = makeResponse();

    filter.catch(
      new AthrDomainError('PERMISSION_DENIED', 'Not allowed.', undefined, {
        target: 'sale',
        currentState: 'payment_resolution_pending',
        currentVersion: 14,
        requiredAction: 'resolve_payment_outcome',
      }),
      makeHost(request, response),
    );

    const body = response.body as any;
    expect(body.error.target).toBe('sale');
    expect(body.error.current_state).toBe('payment_resolution_pending');
    expect(body.error.current_version).toBe(14);
    expect(body.error.required_action).toBe('resolve_payment_outcome');
  });

  it('maps a plain NestJS HttpException via the narrow status fallback table', () => {
    const request = { method: 'GET', originalUrl: '/api/v1/x', requestId: 'req_3', correlationId: 'corr_3' };
    const response = makeResponse();

    filter.catch(new NotFoundException('missing'), makeHost(request, response));

    expect(response.statusCode).toBe(404);
    expect((response.body as any).error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('preserves the real HTTP status of an unmapped HttpException under a generic registered code', () => {
    const request = { method: 'GET', originalUrl: '/api/v1/x', requestId: 'req_4', correlationId: 'corr_4' };
    const response = makeResponse();

    filter.catch(new HttpException('too many requests', 429), makeHost(request, response));

    expect(response.statusCode).toBe(429);
    expect((response.body as any).error.code).toBe('UNEXPECTED_PROCESSING_ERROR');
  });

  it('always sets X-Request-Id and X-Correlation-Id response headers', () => {
    const request = { method: 'GET', originalUrl: '/api/v1/x', requestId: 'req_5', correlationId: 'corr_5' };
    const response = makeResponse();

    filter.catch(new Error('boom'), makeHost(request, response));

    expect(response.headers['X-Request-Id']).toBe('req_5');
    expect(response.headers['X-Correlation-Id']).toBe('corr_5');
  });

  it('generates request/correlation ids when the request has none', () => {
    const request = { method: 'GET', originalUrl: '/api/v1/x' };
    const response = makeResponse();

    filter.catch(new Error('boom'), makeHost(request, response));

    const body = response.body as any;
    expect(typeof body.meta.request_id).toBe('string');
    expect(body.meta.request_id.length).toBeGreaterThan(0);
    expect(typeof body.meta.correlation_id).toBe('string');
  });
});
