import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProductTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_ar: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_en: string;

  /** Validated by `parseAttributeDefinitions` (the single attribute schema). */
  @IsArray()
  attributes: unknown[];
}

export class UpdateProductTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @IsArray()
  attributes?: unknown[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
