import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
import { IsQuantity } from '../../common/quantity';

const MAX_SERIALS_PER_LINE = 1000;

/**
 * Serial numbers reach the API from a scanner in a shop with no way to fix a
 * rejected sale, so they are cleaned, not validated: trimmed, blanks and
 * over-long entries dropped, duplicates removed. Whatever is left is what the
 * server records; an unusable value simply means "not captured".
 */
function cleanSerialList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const serials = value
    .filter((entry): entry is string | number => typeof entry === 'string' || typeof entry === 'number')
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0 && entry.length <= 191);
  const unique = [...new Set(serials)].slice(0, MAX_SERIALS_PER_LINE);
  return unique.length ? unique : undefined;
}

function cleanBatchNo(value: unknown): string | undefined {
  const batchNo = typeof value === 'string' ? value.trim() : '';
  return batchNo.length > 0 && batchNo.length <= 100 ? batchNo : undefined;
}

export class CreateSaleItemDto {
  @IsUUID()
  variant_id: string;

  @IsQuantity()
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

  /** "L · أسود": what the cashier saw. POS <= 1.5 sent size/color instead. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  variant_label_snapshot?: string;

  /**
   * Serial numbers of the units sold, one per unit (POS >= 1.7, serial-tracked
   * items). Always optional: a sale is never refused over tracking data; missing
   * or unknown serials are accepted and reported as warning codes.
   */
  @IsOptional()
  @Transform(({ value }) => cleanSerialList(value))
  @IsArray()
  @IsString({ each: true })
  serials?: string[];

  /** Batch the cashier picked for a batch-tracked item; absent = the server draws FEFO. */
  @IsOptional()
  @Transform(({ value }) => cleanBatchNo(value))
  @IsString()
  batch_no?: string;

  /** Deprecated and ignored: accepted only so sales queued by POS <= 1.5 still validate and upload. */
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
