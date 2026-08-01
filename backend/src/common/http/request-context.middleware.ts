import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '@athr/contracts';

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._-]{8,80}$/;

export interface RequestContext {
  requestStartedAt: bigint;
  requestId: string;
  correlationId: string;
}

/**
 * Generates/propagates `X-Request-Id` and `X-Correlation-Id` on every request
 * and response (API Contract v1.0 §6). Request-id preserves a client-supplied
 * value when it matches the existing validation pattern (unchanged from the
 * inline middleware this replaces, so `PerformanceInterceptor` and
 * `ApiExceptionFilter` — both of which read `req.requestId`/`req.requestStartedAt`
 * — see identical behavior to before). Correlation-id is always server-generated.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use = (req: Request & Partial<RequestContext>, res: Response, next: NextFunction): void => {
    req.requestStartedAt = process.hrtime.bigint();

    const supplied = String(req.headers['x-request-id'] || '');
    req.requestId = REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
    req.correlationId = randomUUID();

    res.setHeader(REQUEST_ID_HEADER, req.requestId);
    res.setHeader(CORRELATION_ID_HEADER, req.correlationId);

    next();
  };
}
