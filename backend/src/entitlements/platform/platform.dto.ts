import { SubscriptionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListTenantsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

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

class NoteFields {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ChangePlanDto extends NoteFields {
  @IsString()
  plan_code: string;
}

export class SetStatusDto extends NoteFields {
  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus;
}

export class ExtendDto extends NoteFields {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  days?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  months?: number;
}

export class AddNoteDto {
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note: string;
}

export class CreatePlanDto {
  @Matches(/^[a-z][a-z0-9_-]{1,39}$/, { message: 'code must be a lowercase slug of 2-40 characters' })
  code: string;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name_ar: string;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name_en: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999)
  price_monthly: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  /** `{ branches: 3, users: null }`; keys are checked against the catalog, null/absent = unlimited. */
  @IsObject()
  limits: Record<string, number | null>;

  @IsArray()
  @IsString({ each: true })
  features: string[];

  @IsOptional()
  @IsBoolean()
  is_public?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}

/** The code of an existing plan never changes. */
export class UpdatePlanDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999)
  price_monthly?: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  @IsOptional()
  @IsObject()
  limits?: Record<string, number | null>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  is_public?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}
