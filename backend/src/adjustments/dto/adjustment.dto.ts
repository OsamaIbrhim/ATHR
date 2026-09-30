import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { StockAdjustmentStatus } from '@prisma/client';
import { IsSignedQuantity } from '../../common/quantity';
import { PageQueryDto } from '../../common/page-query.dto';
import { ADJUSTMENT_REASON_CODES } from '../adjustment-reasons';

export const MAX_ADJUSTMENT_LINES = 300;

export class AdjustmentLineDto {
  @IsUUID()
  variant_id: string;

  /** Positive adds stock, negative removes it. */
  @IsSignedQuantity()
  qty_delta: number;

  @IsIn(ADJUSTMENT_REASON_CODES)
  reason_code: string;

  /** Required when the reason is `other`. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

class AdjustmentBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ADJUSTMENT_LINES)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineDto)
  lines: AdjustmentLineDto[];
}

export class CreateAdjustmentDto extends AdjustmentBodyDto {
  @IsUUID()
  branch_id: string;

  /** Optional client key: re-sending the same key returns the document it created. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,100}$/, { message: 'command_id must be 8-100 letters, digits or . _ : -' })
  command_id?: string;
}

/** Replaces the note and all lines of a draft. */
export class UpdateAdjustmentDto extends AdjustmentBodyDto {}

export class CancelAdjustmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListAdjustmentsDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(StockAdjustmentStatus)
  status?: StockAdjustmentStatus;

  @IsOptional()
  @IsUUID()
  branch_id?: string;

  /** Matches the document number. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  q?: string;
}
