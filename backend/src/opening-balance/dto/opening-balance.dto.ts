import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsQuantity } from '../../common/quantity';

export const MAX_OPENING_LINES = 500;

export class OpeningBalanceLineDto {
  @IsUUID()
  variant_id: string;

  @IsQuantity()
  qty: number;

  /** Cost of one unit. Omitted = the variant's current cost. Zero is allowed (the UI warns). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(9999999999)
  unit_cost?: number;
}

export class PostOpeningBalanceDto {
  @IsUUID()
  branch_id: string;

  /** Client-chosen key of this submission; the same key replays the same result. */
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'idempotency_key may contain letters, digits and . _ : -' })
  idempotency_key: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_OPENING_LINES)
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineDto)
  lines: OpeningBalanceLineDto[];
}
