import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { BundleReturnPolicy, BundleStatus } from '@prisma/client';

const STATUS_VALUES = Object.values(BundleStatus);
const RETURN_POLICY_VALUES = Object.values(BundleReturnPolicy);

export class BundleComponentInputDto {
  @IsUUID()
  variant_id: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  qty: number;
}

/**
 * CLAUDE.md §1.1. BR-BND-100/101: components are set at creation and fixed
 * once the bundle leaves `draft` — mutable only via `supersede()`, which
 * creates a new draft version (mirroring `TaxCode`).
 */
export class CreateBundleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BundleComponentInputDto)
  components: BundleComponentInputDto[];

  // OD-CAT-012/BR-BND-105 analogue: not required at creation (a draft may be
  // incomplete) but required before `activate()` — see `BundleService.activate`.
  @IsOptional()
  @IsIn(RETURN_POLICY_VALUES)
  return_policy?: BundleReturnPolicy;
}

/** Every field optional — only a `draft` bundle may be edited. `components`, when present, replaces the full set. */
export class UpdateBundleDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BundleComponentInputDto)
  components?: BundleComponentInputDto[];

  @IsOptional()
  @IsIn(RETURN_POLICY_VALUES)
  return_policy?: BundleReturnPolicy;
}

export class ListBundlesDto {
  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: BundleStatus;

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

/** Creates the next DRAFT version (BR-BND-101) — the live version is untouched until this one activates. */
export class SupersedeBundleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BundleComponentInputDto)
  components: BundleComponentInputDto[];

  @IsOptional()
  @IsIn(RETURN_POLICY_VALUES)
  return_policy?: BundleReturnPolicy;
}
