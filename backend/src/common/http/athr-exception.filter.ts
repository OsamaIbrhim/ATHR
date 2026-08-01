import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import type { ErrorDetail, ErrorEnvelope } from '@athr/contracts';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER } from '@athr/contracts';
import { type ErrorCode, type ErrorMetadata, getErrorMetadata } from '@athr/error-registry';

/**
 * Domain/Application code should throw this (never a raw NestJS `HttpException`)
 * once WP-005+ domain code exists — `code` must already be registered in
 * `@athr/error-registry`. `AthrExceptionFilter` is the only place that maps a
 * domain failure to HTTP; that seam is established here even though almost
 * nothing throws `AthrDomainError` yet.
 */
export class AthrDomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: readonly ErrorDetail[],
    public readonly overrides?: Readonly<{
      httpStatus?: number;
      target?: string;
      currentState?: string;
      currentVersion?: number;
      requiredAction?: string;
      operationId?: string | null;
    }>,
  ) {
    super(message ?? code);
    this.name = 'AthrDomainError';
  }
}

// Best-effort mapping for plain NestJS HttpExceptions thrown by code that
// hasn't been migrated to `AthrDomainError` yet. Deliberately narrow: only
// the statuses this WP's registered codes actually cover. Anything else
// preserves its real HTTP status under the generic `UNEXPECTED_PROCESSING_ERROR`
// code rather than being forced to 500.
const HTTP_STATUS_FALLBACK_CODE: Readonly<Partial<Record<number, ErrorCode>>> = {
  400: 'REQUEST_FIELD_VALUE_INVALID',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'PERMISSION_DENIED',
  404: 'RESOURCE_NOT_FOUND',
};

interface ResolvedError {
  readonly code: ErrorCode;
  readonly metadata: ErrorMetadata;
  readonly message: string;
  readonly details?: readonly ErrorDetail[];
  readonly target?: string;
  readonly currentState?: string;
  readonly currentVersion?: number;
  readonly requiredAction?: string;
  readonly operationId?: string | null;
}

@Catch()
export class AthrExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AthrExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { requestId?: string; correlationId?: string }>();
    const response = context.getResponse<Response>();
    const requestId = request.requestId ?? randomUUID();
    const correlationId = request.correlationId ?? randomUUID();
    const resolved = this.resolve(exception);

    if (resolved.metadata.defaultHttpStatus >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `${request.method} ${request.originalUrl} [${requestId}] [${correlationId}]`,
        stack,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.originalUrl} ${resolved.metadata.defaultHttpStatus} ${resolved.code} [${requestId}]`,
      );
    }

    const body: ErrorEnvelope = {
      error: {
        code: resolved.code,
        category: resolved.metadata.category,
        message: resolved.message,
        retryable: resolved.metadata.retryable,
        retry_mode: resolved.metadata.retryMode,
        outcome: resolved.metadata.outcome,
        severity: resolved.metadata.severity,
        target: resolved.target,
        details: resolved.details,
        current_state: resolved.currentState,
        current_version: resolved.currentVersion,
        required_action: resolved.requiredAction,
        operation_id: resolved.operationId,
        support_reference: requestId,
      },
      meta: {
        request_id: requestId,
        correlation_id: correlationId,
        occurred_at: new Date().toISOString(),
      },
    };

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    response.status(resolved.metadata.defaultHttpStatus).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof AthrDomainError) {
      const metadata = getErrorMetadata(exception.code);
      return {
        code: exception.code,
        metadata: exception.overrides?.httpStatus
          ? { ...metadata, defaultHttpStatus: exception.overrides.httpStatus }
          : metadata,
        message: exception.message,
        details: exception.details,
        target: exception.overrides?.target,
        currentState: exception.overrides?.currentState,
        currentVersion: exception.overrides?.currentVersion,
        requiredAction: exception.overrides?.requiredAction,
        operationId: exception.overrides?.operationId,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const mappedCode = HTTP_STATUS_FALLBACK_CODE[status];
      if (mappedCode) {
        return { code: mappedCode, metadata: getErrorMetadata(mappedCode), message: exception.message };
      }

      const generic = getErrorMetadata('UNEXPECTED_PROCESSING_ERROR');
      return {
        code: 'UNEXPECTED_PROCESSING_ERROR',
        metadata: { ...generic, defaultHttpStatus: status },
        message: exception.message,
      };
    }

    // Never surface the raw exception message here: it may be a Prisma/SQL
    // error or another provider detail (Error Catalog §2 rule 5).
    return {
      code: 'INTERNAL_ERROR',
      metadata: getErrorMetadata('INTERNAL_ERROR'),
      message: 'An unexpected error occurred. Give the reference number to support.',
    };
  }
}
