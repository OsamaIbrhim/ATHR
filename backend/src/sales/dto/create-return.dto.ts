import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsQuantity } from '../../common/quantity';

export class CreateReturnItemDto {
  @IsUUID()
  sales_invoice_item_id: string;

  @IsQuantity()
  qty: number;

  /** Serial-tracked items: the serial of each returned unit (each must have been sold on this line). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  serials?: string[];
}

export class CreateReturnDto {
  @IsUUID()
  original_invoice_id: string;

  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  @ArrayMinSize(1)
  items: CreateReturnItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
