import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export enum UomKindDto {
  base = 'base',
  derived = 'derived',
}

export class CreateUomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_en: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @IsEnum(UomKindDto)
  kind?: UomKindDto;

  // BR-UOM-103: max decimal places a quantity in this unit may carry.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  precision?: number;
}

export class UpdateUomDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_en?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name_ar?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  precision?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
