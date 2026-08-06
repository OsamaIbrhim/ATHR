import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { getErrorMetadata } from '@athr/error-registry';
import { AthrDomainError } from './http/athr-exception.filter';

export type FriendlyError = {
  status: number;
  code: string;
  message: string;
  message_ar: string;
  field?: string;
  details?: string[];
  retryable?: boolean;
  retry_after_ms?: number;
};

const GENERIC: Record<number, Omit<FriendlyError, 'status'>> = {
  400: { code: 'VALIDATION_ERROR', message: 'Check the entered information and try again.', message_ar: 'راجع البيانات المدخلة وحاول مرة أخرى.' },
  401: { code: 'AUTH_INVALID', message: 'The login information or session is no longer valid.', message_ar: 'بيانات الدخول أو الجلسة لم تعد صالحة. سجل الدخول مرة أخرى.' },
  403: { code: 'PERMISSION_DENIED', message: 'Your account is not allowed to perform this action.', message_ar: 'حسابك غير مصرح له بتنفيذ هذا الإجراء.' },
  404: { code: 'NOT_FOUND', message: 'The requested record was not found. Check the entered value.', message_ar: 'لم يتم العثور على السجل المطلوب. راجع القيمة المدخلة.' },
  409: { code: 'CONFLICT', message: 'The operation conflicts with existing data. Refresh and try again.', message_ar: 'تتعارض العملية مع بيانات موجودة. حدّث الصفحة وحاول مرة أخرى.' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests. Wait briefly and try again.', message_ar: 'عدد الطلبات كبير. انتظر قليلاً ثم حاول مرة أخرى.' },
  500: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Give the reference number to support.', message_ar: 'حدث خطأ غير متوقع. أرسل الرقم المرجعي إلى الدعم.' },
};

function firstField(messages: string[]) {
  const match = messages[0]?.match(/^([a-zA-Z_][\w]*)\s/);
  return match?.[1];
}

function structuredHttpError(
  status: number,
  response: unknown,
): FriendlyError | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return null;
  }

  const payload = response as Record<string, unknown>;
  const code =
    typeof payload.code === 'string' ? payload.code.trim() : '';
  const message =
    typeof payload.message === 'string' ? payload.message.trim() : '';
  const messageAr =
    typeof payload.message_ar === 'string'
      ? payload.message_ar.trim()
      : '';

  // Nest's default HttpException response also uses an object, but it does not
  // carry a stable business code. Preserve only explicitly structured errors.
  if (!code || (!message && !messageAr)) return null;

  const retryAfterMs = Number(payload.retry_after_ms);
  return {
    status,
    code,
    message: message || messageAr,
    message_ar: messageAr || message,
    field:
      typeof payload.field === 'string'
        ? payload.field
        : undefined,
    details: Array.isArray(payload.details)
      ? payload.details.map(String)
      : undefined,
    retryable:
      typeof payload.retryable === 'boolean'
        ? payload.retryable
        : undefined,
    retry_after_ms: Number.isFinite(retryAfterMs)
      ? retryAfterMs
      : undefined,
  };
}

export function toFriendlyError(exception: unknown): FriendlyError {
  // AthrDomainError is a plain Error, not an HttpException, so without this
  // branch it always fell through to the generic 500 below regardless of the
  // registered error code's real status (e.g. a 403 PERMISSION_DENIED from
  // PermissionGuard was reported to POS/admin clients as an opaque
  // INTERNAL_ERROR). AthrExceptionFilter already does this mapping correctly,
  // but per main.ts it only applies per-route via @UseFilters — everything
  // else, including every @RequirePermission-guarded route, resolves here.
  if (exception instanceof AthrDomainError) {
    const metadata = getErrorMetadata(exception.code);
    return {
      status: exception.overrides?.httpStatus ?? metadata.defaultHttpStatus,
      code: exception.code,
      message: exception.message,
      message_ar: exception.message,
      retryable: metadata.retryable,
    };
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      const target = Array.isArray(exception.meta?.target) ? exception.meta?.target[0] : exception.meta?.target;
      return {
        status: HttpStatus.CONFLICT,
        code: 'DUPLICATE_VALUE',
        field: typeof target === 'string' ? target : undefined,
        message: 'This value is already used by another record.',
        message_ar: 'هذه القيمة مستخدمة بالفعل في سجل آخر.',
      };
    }
    if (exception.code === 'P2025') {
      return { status: 404, ...GENERIC[404] };
    }
  }

  const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  const response = exception instanceof HttpException ? exception.getResponse() : undefined;
  const structured = structuredHttpError(status, response);
  if (structured) return structured;

  const rawMessages = typeof response === 'object' && response && 'message' in response
    ? (Array.isArray(response.message) ? response.message.map(String) : [String(response.message)])
    : exception instanceof Error ? [exception.message] : [];
  const raw = rawMessages.join(' ').toLowerCase();

  if (raw.includes('insufficient stock')) {
    return {
      status: HttpStatus.CONFLICT,
      code: 'INSUFFICIENT_STOCK',
      message: 'The requested quantity is not available. Refresh stock and reduce the quantity.',
      message_ar: 'الكمية المطلوبة غير متاحة. حدّث المخزون وقلّل الكمية.',
    };
  }
  if (raw.includes('return window expired')) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'RETURN_WINDOW_EXPIRED',
      message: 'The allowed 14-day return period has ended.',
      message_ar: 'انتهت فترة الإرجاع المسموح بها وهي 14 يوماً.',
    };
  }
  if (raw.includes('another branch')) {
    return {
      status: HttpStatus.FORBIDDEN,
      code: 'BRANCH_ACCESS_DENIED',
      message: 'This record belongs to another branch.',
      message_ar: 'هذا السجل تابع لفرع آخر ولا يمكن تنفيذه من هذا الفرع.',
    };
  }
  if (raw.includes('revoked')) {
    return {
      status: HttpStatus.FORBIDDEN,
      code: 'TERMINAL_REVOKED',
      message: 'This POS terminal was disabled by an administrator.',
      message_ar: 'تم تعطيل نقطة البيع هذه بواسطة المسؤول.',
    };
  }
  if (raw.includes('must be enrolled')) {
    return {
      status: HttpStatus.UNAUTHORIZED,
      code: 'TERMINAL_NOT_ENROLLED',
      message: 'This POS terminal must be enrolled by a branch manager.',
      message_ar: 'يجب تسجيل نقطة البيع هذه باستخدام رمز من مدير الفرع.',
    };
  }
  if (raw.includes('invalid pos terminal credential')) {
    return {
      status: HttpStatus.UNAUTHORIZED,
      code: 'TERMINAL_CREDENTIAL_INVALID',
      message: 'The saved terminal credential is no longer valid. Enroll the device again.',
      message_ar: 'بيانات تسجيل الجهاز لم تعد صالحة. أعد تسجيل الجهاز من لوحة الإدارة.',
    };
  }
  if (raw.includes('enrollment code')) {
    return {
      status: HttpStatus.UNAUTHORIZED,
      code: 'ENROLLMENT_CODE_INVALID',
      field: 'enrollment_code',
      message: 'The enrollment code is invalid, expired, or already used.',
      message_ar: 'رمز تسجيل الجهاز غير صحيح أو منتهي أو تم استخدامه من قبل.',
    };
  }
  if (raw.includes('invalid credentials')) {
    return {
      status: HttpStatus.UNAUTHORIZED,
      code: 'LOGIN_INVALID',
      field: 'phone',
      message: 'The phone number or password is incorrect.',
      message_ar: 'رقم الهاتف أو كلمة المرور غير صحيحة.',
    };
  }
  if (status === HttpStatus.BAD_REQUEST && rawMessages.length) {
    return {
      status,
      ...GENERIC[400],
      field: firstField(rawMessages),
      details: rawMessages,
    };
  }
  const fallback = GENERIC[status] || GENERIC[500];
  return { status: GENERIC[status] ? status : 500, ...fallback };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { requestId?: string }>();
    const response = context.getResponse<Response>();
    const error = toFriendlyError(exception);
    const requestId = request.requestId || randomUUID();
    response.setHeader('x-request-id', requestId);

    if (error.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${request.originalUrl} [${requestId}]`, stack);
    } else {
      this.logger.warn(`${request.method} ${request.originalUrl} ${error.status} ${error.code} [${requestId}]`);
    }

    response.status(error.status).json({
      status_code: error.status,
      code: error.code,
      message: error.message,
      message_ar: error.message_ar,
      field: error.field,
      details: error.details,
      retryable: error.retryable,
      retry_after_ms: error.retry_after_ms,
      request_id: requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }
}
