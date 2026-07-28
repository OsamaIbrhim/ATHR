import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateSaleItemDto {
  @IsUUID()
  variant_id: string;

  @IsInt()
  @Min(1)
  qty: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  unit_price: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unit_tax: number;

  @IsString()
  @MaxLength(191)
  sku_snapshot: string;

  @IsString()
  @MaxLength(300)
  name_ar_snapshot: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  name_en_snapshot?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  size_snapshot?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  color_snapshot?: string;
}

export class CreateSaleDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([2])
  event_version: number;

  @IsUUID()
  sync_id: string;

  @IsUUID()
  branch_id: string;

  @IsUUID()
  shift_id: string;

  @IsUUID()
  origin_cashier_id: string;

  @IsString()
  @MaxLength(200)
  cashier_name_snapshot: string;

  @IsUUID()
  seller_id: string;

  @IsString()
  @MaxLength(200)
  seller_name_snapshot: string;

  @IsUUID()
  offline_session_id: string;

  @IsString()
  @Matches(/^[1-9]\d{0,18}$/, {
    message: 'terminal_sequence must be a positive decimal integer',
  })
  terminal_sequence: string;

  @IsDateString()
  occurred_at: string;

  @IsOptional()
  @Matches(/^(?:\+20|0)1[0125]\d{8}$/, {
    message: 'customer_phone must be a valid Egyptian mobile number',
  })
  customer_phone?: string;

  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  @ArrayMinSize(1)
  items: CreateSaleItemDto[];

  @IsString()
  @IsIn(['cash', 'card', 'instapay', 'vodafone_cash', 'installment'])
  payment_method: string;

  @IsOptional()
  @IsIn(['ar', 'en'])
  language?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  local_total: number;
}
