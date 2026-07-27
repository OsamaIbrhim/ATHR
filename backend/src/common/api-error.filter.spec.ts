import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { toFriendlyError } from './api-error.filter';

describe('friendly API errors', () => {
  it('maps login failures to a safe actionable message', () => {
    expect(toFriendlyError(new UnauthorizedException('Invalid credentials'))).toMatchObject({
      status: 401,
      code: 'LOGIN_INVALID',
      field: 'phone',
      message_ar: expect.stringContaining('غير صحيحة'),
    });
  });

  it('preserves validation details and identifies the field', () => {
    const error = toFriendlyError(new BadRequestException({
      message: ['name must be longer than or equal to 2 characters'],
    }));
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'name' });
    expect(error.details).toHaveLength(1);
  });

  it('explains stock conflicts without exposing a stack trace', () => {
    expect(toFriendlyError(new ConflictException('Insufficient stock for variant secret-id'))).toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      message_ar: expect.stringContaining('الكمية'),
    });
  });

  it('preserves structured business errors instead of converting 422 to 500', () => {
    expect(toFriendlyError(new UnprocessableEntityException({
      code: 'LEGACY_PRICE_RECONCILIATION_REQUIRED',
      message: 'The legacy sale requires reconciliation',
      message_ar: 'الفاتورة القديمة تحتاج مراجعة.',
    }))).toMatchObject({
      status: 422,
      code: 'LEGACY_PRICE_RECONCILIATION_REQUIRED',
      message_ar: 'الفاتورة القديمة تحتاج مراجعة.',
    });
  });

  it('preserves retry metadata for transient structured failures', () => {
    expect(toFriendlyError(new ServiceUnavailableException({
      code: 'SALE_TRANSACTION_EXPIRED',
      message: 'Retry the same command',
      message_ar: 'أعد المحاولة بنفس رقم المزامنة.',
      retryable: true,
      retry_after_ms: 2_000,
    }))).toMatchObject({
      status: 503,
      code: 'SALE_TRANSACTION_EXPIRED',
      retryable: true,
      retry_after_ms: 2_000,
    });
  });
});
