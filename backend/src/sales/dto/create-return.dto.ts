import { Type } from 'class-transformer';
import { ArrayMinSize, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { IsQuantity } from '../../common/quantity';

export class CreateReturnItemDto {
  @IsUUID()
  sales_invoice_item_id: string;

  @IsQuantity()
  qty: number;
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
