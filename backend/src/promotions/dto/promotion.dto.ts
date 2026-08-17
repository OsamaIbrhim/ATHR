import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PromotionBenefitType,
  PromotionMinSpendBasis,
  PromotionReturnPolicy,
  PromotionScopeType,
  PromotionStackability,
  PromotionStatus,
} from '@prisma/client';

const STATUS_VALUES = Object.values(PromotionStatus);
const BENEFIT_TYPE_VALUES = Object.values(PromotionBenefitType);
const STACKABILITY_VALUES = Object.values(PromotionStackability);
const SCOPE_TYPE_VALUES = Object.values(PromotionScopeType);
const MIN_SPEND_BASIS_VALUES = Object.values(PromotionMinSpendBasis);
const RETURN_POLICY_VALUES = Object.values(PromotionReturnPolicy);

/**
 * CLAUDE.md §1.1: every new endpoint validates its payload before business
 * logic. BR-BEN-100/OD-CAT-007: `benefit_value` is required for
 * percentage/fixed_amount/fixed_price and meaningless for `bogo`, which uses
 * `bogo_*` instead — enforced with `@ValidateIf` rather than left to the
 * service layer to discover.
 */
export class CreatePromotionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsDateString()
  starts_at: string;

  @IsOptional()
  @IsDateString()
  ends_at?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsIn(STACKABILITY_VALUES)
  stackability?: PromotionStackability;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  stack_group?: string;

  @IsIn(BENEFIT_TYPE_VALUES)
  benefit_type: PromotionBenefitType;

  @ValidateIf((dto: CreatePromotionDto) => dto.benefit_type !== 'bogo')
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  benefit_value?: number;

  @ValidateIf((dto: CreatePromotionDto) => dto.benefit_type === 'bogo')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bogo_buy_qty?: number;

  @ValidateIf((dto: CreatePromotionDto) => dto.benefit_type === 'bogo')
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bogo_get_qty?: number;

  @ValidateIf((dto: CreatePromotionDto) => dto.benefit_type === 'bogo')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  bogo_get_discount_percent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  max_discount_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_units_per_order?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_uses_per_customer?: number;

  @IsOptional()
  @IsIn(SCOPE_TYPE_VALUES)
  scope_type?: PromotionScopeType;

  @ValidateIf((dto: CreatePromotionDto) => !!dto.scope_type && dto.scope_type !== 'all')
  @IsUUID()
  scope_id?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  min_qty?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  min_spend?: number;

  @ValidateIf((dto: CreatePromotionDto) => dto.min_spend !== undefined)
  @IsIn(MIN_SPEND_BASIS_VALUES)
  min_spend_basis?: PromotionMinSpendBasis;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsBoolean()
  requires_coupon?: boolean;

  // OD-CAT-012: not required at creation (a draft may be incomplete) but
  // required before `activate()` — see `PromotionService.activate`.
  @IsOptional()
  @IsIn(RETURN_POLICY_VALUES)
  return_policy?: PromotionReturnPolicy;
}

/** Every field optional — only a `draft` promotion may be edited (BR-PMT-101). */
export class UpdatePromotionDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsDateString()
  starts_at?: string;

  @IsOptional()
  @IsDateString()
  ends_at?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsIn(STACKABILITY_VALUES)
  stackability?: PromotionStackability;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  stack_group?: string;

  @IsOptional()
  @IsIn(BENEFIT_TYPE_VALUES)
  benefit_type?: PromotionBenefitType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  benefit_value?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bogo_buy_qty?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bogo_get_qty?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  bogo_get_discount_percent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  max_discount_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_units_per_order?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_uses_per_customer?: number;

  @IsOptional()
  @IsIn(SCOPE_TYPE_VALUES)
  scope_type?: PromotionScopeType;

  @IsOptional()
  @IsUUID()
  scope_id?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  min_qty?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  min_spend?: number;

  @IsOptional()
  @IsIn(MIN_SPEND_BASIS_VALUES)
  min_spend_basis?: PromotionMinSpendBasis;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsBoolean()
  requires_coupon?: boolean;

  @IsOptional()
  @IsIn(RETURN_POLICY_VALUES)
  return_policy?: PromotionReturnPolicy;
}

export class ListPromotionsDto {
  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: PromotionStatus;

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
