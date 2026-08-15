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
} from 'class-validator';
import { TaxCodeStatus, TaxMode, TaxRoundingPolicy } from '@prisma/client';

const STATUS_VALUES = Object.values(TaxCodeStatus);
const MODE_VALUES = Object.values(TaxMode);
const ROUNDING_VALUES = Object.values(TaxRoundingPolicy);

/** CLAUDE.md §1.1: every new endpoint validates its payload before business logic. */
export class CreateTaxCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name_en: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class CreateTaxCodeDto {
  @IsUUID()
  tax_category_id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name_en: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  // Percentage points, e.g. 14 for 14%. Bounded at 100: a rate above 100% is
  // never a real tax and is far more likely a caller sending a 0-1 fraction
  // scaled wrong. Negative is rejected outright.
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  rate: number;

  // BR-TAX-204: required, never defaulted. A caller that does not know
  // whether its prices include tax cannot create a code.
  @IsIn(MODE_VALUES)
  tax_mode: TaxMode;

  @IsOptional()
  @IsIn(ROUNDING_VALUES)
  rounding_policy?: TaxRoundingPolicy;

  // OD-CAT-006: recorded, not resolved. There is no jurisdiction engine.
  @IsOptional()
  @IsString()
  @MaxLength(10)
  jurisdiction?: string;

  @IsOptional()
  @IsBoolean()
  exemption_allowed?: boolean;

  @IsOptional()
  @IsDateString()
  effective_from?: string;
}

export class UpdateTaxCodeDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name_en?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  rate?: number;

  @IsOptional()
  @IsIn(MODE_VALUES)
  tax_mode?: TaxMode;

  @IsOptional()
  @IsIn(ROUNDING_VALUES)
  rounding_policy?: TaxRoundingPolicy;

  @IsOptional()
  @IsBoolean()
  exemption_allowed?: boolean;

  @IsOptional()
  @IsDateString()
  effective_from?: string;
}

/** BR-TAX-203: a new rate is a new version, never an edit to the live one. */
export class SupersedeTaxCodeDto {
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  rate: number;

  @IsIn(MODE_VALUES)
  tax_mode: TaxMode;

  @IsOptional()
  @IsDateString()
  effective_from?: string;
}

export class ScheduleTaxCodeDto {
  @IsOptional()
  @IsDateString()
  effective_from?: string;
}

/** CLAUDE.md §3.2: list endpoints paginate. */
export class ListTaxCodesDto {
  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: TaxCodeStatus;

  @IsOptional()
  @IsUUID()
  tax_category_id?: string;

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

export class ListTaxCategoriesDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  active_only?: boolean;

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
