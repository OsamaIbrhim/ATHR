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

  // WP-009 Phase 0, defect 2. Before this fix, these three sites threw a
  // plain-string ConflictException. ConflictException already sets HTTP 409
  // at construction, so they never reached the 500 the read-from-source
  // hypothesis predicted -- but `structuredHttpError` requires a `code` on
  // the response payload, so a bare string falls through every substring
  // rule below (none of these messages contain "insufficient stock") to the
  // GENERIC[409] fallback: 409 CONFLICT, not 409 INVENTORY_INSUFFICIENT_
  // AVAILABLE_QUANTITY. Measured with a throwaway repro before this diff:
  // {status:409, code:"CONFLICT"} for all three. The fix throws a structured
  // ConflictException instead, matching the sales.service.ts /
  // terminals.service.ts convention for codes that error-registry does not
  // (yet) carry.
  describe('inventory insufficient-quantity sites carry their catalog code', () => {
    it('purchasing supplier-return (purchasing.service.ts ~722)', () => {
      expect(toFriendlyError(new ConflictException({
        code: 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
        message: 'Insufficient unreserved stock to return variant abc-123',
        message_ar: 'الكمية غير المحجوزة من المخزون غير كافية لإتمام مرتجع المورد.',
      }))).toMatchObject({
        status: 409,
        code: 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
      });
    });

    it('purchasing purchase-reversal (purchasing.service.ts ~1051)', () => {
      expect(toFriendlyError(new ConflictException({
        code: 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
        message: 'Insufficient unreserved stock to reverse variant abc-123',
        message_ar: 'الكمية غير المحجوزة من المخزون غير كافية لعكس عملية الشراء.',
      }))).toMatchObject({
        status: 409,
        code: 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
      });
    });

    it('transfers ship (transfers.service.ts ~244)', () => {
      expect(toFriendlyError(new ConflictException({
        code: 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
        message: 'Insufficient available stock for variant abc-123',
        message_ar: 'الكمية المتاحة من المخزون غير كافية لإتمام الشحن.',
      }))).toMatchObject({
        status: 409,
        code: 'INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY',
      });
    });

    it('a plain-string version of these messages would NOT get this code (documents the bug this fix closes)', () => {
      const result = toFriendlyError(new ConflictException('Insufficient available stock for variant abc-123'));
      expect(result.status).toBe(409);
      expect(result.code).not.toBe('INVENTORY_INSUFFICIENT_AVAILABLE_QUANTITY');
      expect(result.code).toBe('CONFLICT');
    });
  });
});
