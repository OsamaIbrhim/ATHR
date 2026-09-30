import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsQuantity } from '../../common/quantity';

export class ReceivePurchaseItemDto {
  @IsUUID()
  variant_id: string;

  @IsQuantity()
  qty: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(999999999.9999)
  unit_cost: number;

  /** Serial-tracked variants: one serial per unit received (`qty` of them). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  serials?: string[];

  /** Batch-tracked variants: the batch this line's `qty` belongs to (repeat the variant for more batches). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batch_no?: string;

  /** Expiry of that batch, YYYY-MM-DD; an existing batch keeps the expiry it has. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expiry_date must be YYYY-MM-DD' })
  expiry_date?: string;
}

export class ReceivePurchaseDto {
  @IsOptional()
  @IsUUID()
  command_id?: string;

  @IsUUID()
  supplier_id: string;

  @IsUUID()
  branch_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoice_number?: string;

  @IsOptional()
  @IsDateString()
  invoice_date?: string;

  @IsOptional()
  @IsDateString()
  received_at?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount_amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discount_percent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  ocr_source_file?: string;

  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  items: ReceivePurchaseItemDto[];
}

export class ReversePurchaseDto {
  @IsOptional()
  @IsUUID()
  command_id?: string;

  @IsString()
  @MaxLength(500)
  reason: string;
}


export class CreateSupplierReturnItemDto {
  @IsUUID()
  purchase_invoice_item_id: string;

  @IsQuantity()
  qty: number;

  /** Serial-tracked variants: the serial of each unit returned. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  serials?: string[];

  /** Batch-tracked variants: the batch the units are taken from. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batch_no?: string;
}

export class CreateSupplierReturnDto {
  @IsUUID()
  command_id: string;

  @IsString()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsDateString()
  occurred_at?: string;

  @ValidateNested({ each: true })
  @Type(() => CreateSupplierReturnItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  items: CreateSupplierReturnItemDto[];
}

export class OcrImportDto {
  @IsString()
  @MaxLength(2048)
  fileUrl: string;
}
