import { Type } from 'class-transformer';
import {
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import { CreateSaleDto } from './create-sale.dto';

export class SubmitSaleReviewDto {
  @ValidateNested()
  @Type(() => CreateSaleDto)
  command: CreateSaleDto;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  local_invoice_number: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  local_total: number;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  error_code: string;

  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  error_message: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  request_id?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  attempt_count: number;
}

export class ListSaleReviewsDto {
  @IsOptional()
  @IsIn(['pending', 'processing', 'approved', 'rejected', 'linked'])
  status?: string;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size = 30;
}

export class ResolveSaleReviewDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  confirmation_reference?: string;

  @IsOptional()
  @IsBoolean()
  confirm_financial_settlement?: boolean;
}
