import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength, Min } from 'class-validator';

export class CalculatePriceDto {
  @IsUUID()
  variant_id: string;

  // BR-PSL-104: the qualifying quantity for quantity-break resolution.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty = 1;

  // WP-008 Phase D: optional promotion-eligibility context. All three are
  // optional because this endpoint has no cart/session of its own — a caller
  // that omits them still gets a valid base-price quote, just with fewer
  // promotions eligible (BR-CND-100 conditions this quote cannot resolve are
  // excluded, never silently assumed satisfied — see
  // `PromotionEvaluationService`).
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  coupon_code?: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;
}
