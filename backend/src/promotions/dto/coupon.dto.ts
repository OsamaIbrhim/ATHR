import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CouponStatus, CouponType } from '@prisma/client';

const TYPE_VALUES = Object.values(CouponType);
const STATUS_VALUES = Object.values(CouponStatus);

/**
 * CLAUDE.md §1.1. BR-CPN-206: `code` is accepted here (the operator must type
 * it once) but this DTO's own `code` value must never be echoed back in an
 * error message or logged verbatim — see `CouponService`/`CouponRepository`.
 */
export class CreateCouponDto {
  @IsUUID()
  promotion_id: string;

  @IsString()
  @MinLength(3)
  @MaxLength(64)
  code: string;

  @IsOptional()
  @IsIn(TYPE_VALUES)
  type?: CouponType;

  // Required (service-enforced) when type = customer_bound; ignored otherwise.
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_total_uses?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_uses_per_customer?: number;

  @IsOptional()
  @IsDateString()
  expires_at?: string;
}

export class UpdateCouponDto {
  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: CouponStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_total_uses?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_uses_per_customer?: number;

  @IsOptional()
  @IsDateString()
  expires_at?: string;
}

export class ListCouponsDto {
  @IsOptional()
  @IsUUID()
  promotion_id?: string;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: CouponStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number;
}

/**
 * BR-CPN-203/204: redemption is final at Sale completion and idempotent. The
 * caller's `Idempotency-Key` HTTP header (validated by the pre-existing
 * `IdempotencyKeyGuard`, `IDEMPOTENCY_KEY_HEADER`) is what makes a retried
 * redemption request never double-apply — it is NOT a body field, so it
 * cannot be forgotten or spoofed independently of the header the rest of the
 * API already treats as the idempotency boundary (API Contract §19-§22).
 */
export class RedeemCouponDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  code: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount_applied?: number;
}
