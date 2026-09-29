import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsNonNegativeQuantity, IsQuantity } from '../../common/quantity';

export class TransferItemDto {
  @IsUUID()
  variant_id: string;

  @IsQuantity()
  qty: number;
}

export class CreateTransferDto {
  @IsUUID()
  from_branch_id: string;

  @IsUUID()
  to_branch_id: string;

  @IsOptional()
  @IsUUID()
  command_id?: string;

  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  @ArrayMinSize(1)
  items: TransferItemDto[];
}

export class TransferCommandDto {
  @IsOptional()
  @IsUUID()
  command_id?: string;
}

export class CancelTransferDto extends TransferCommandDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ReceiveTransferItemDto {
  @IsUUID()
  transfer_item_id: string;

  @IsNonNegativeQuantity()
  received_qty: number;

  @IsOptional()
  @IsNonNegativeQuantity()
  damaged_qty?: number;

  @IsOptional()
  @IsNonNegativeQuantity()
  missing_qty?: number;
}

export class ReceiveTransferDto extends TransferCommandDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferItemDto)
  items?: ReceiveTransferItemDto[];
}
