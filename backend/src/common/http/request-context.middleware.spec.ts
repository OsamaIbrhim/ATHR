import { RequestContextMiddleware } from './request-context.middleware';

function makeRequest(headers: Record<string, string> = {}) {
  return { headers } as any;
}

function makeResponse() {
  return {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  } as any;
}

describe('RequestContextMiddleware', () => {
  it('generates an X-Request-Id when the client did not send one', () => {
    const middleware = new RequestContextMiddleware();
    const req = makeRequest();
    const res = makeResponse();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(0);
    expect(res.headers['X-Request-Id']).toBe(req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('echoes a client-supplied X-Request-Id that matches the validation pattern', () => {
    const middleware = new RequestContextMiddleware();
    const req = makeRequest({ 'x-request-id': 'client-supplied-id-123' });
    const res = makeResponse();

    middleware.use(req, res, jest.fn());

    expect(req.requestId).toBe('client-supplied-id-123');
    expect(res.headers['X-Request-Id']).toBe('client-supplied-id-123');
  });

  it('replaces a malformed client-supplied X-Request-Id with a generated one', () => {
    const middleware = new RequestContextMiddleware();
    const req = makeRequest({ 'x-request-id': 'a b' }); // spaces are invalid per the pattern
    const res = makeResponse();

    middleware.use(req, res, jest.fn());

    expect(req.requestId).not.toBe('a b');
    expect(req.requestId.length).toBeGreaterThan(0);
  });

  it('always generates a server-side X-Correlation-Id distinct from the request id', () => {
    const middleware = new RequestContextMiddleware();
    const req = makeRequest({ 'x-request-id': 'client-supplied-id-123' });
    const res = makeResponse();

    middleware.use(req, res, jest.fn());

    expect(typeof req.correlationId).toBe('string');
    expect(req.correlationId).not.toBe(req.requestId);
    expect(res.headers['X-Correlation-Id']).toBe(req.correlationId);
  });

  it('stamps requestStartedAt so downstream timing (PerformanceInterceptor) keeps working', () => {
    const middleware = new RequestContextMiddleware();
    const req = makeRequest();
    const res = makeResponse();

    middleware.use(req, res, jest.fn());

    expect(typeof req.requestStartedAt).toBe('bigint');
  });
});
