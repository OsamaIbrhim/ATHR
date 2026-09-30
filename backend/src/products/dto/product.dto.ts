import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
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
import { Transform, Type } from 'class-transformer';
import { BarcodeKind, ItemType, TrackingMode } from '@prisma/client';
import { IsQuantity } from '../../common/quantity';

export class BarcodeDto {
  @Matches(/^[A-Za-z0-9._-]{1,64}$/, { message: 'code must be 1-64 letters, digits, dot, dash or underscore' })
  code: string;

  /** Units one scan adds (a pack of 6 = 6). Defaults to 1. */
  @IsOptional()
  @IsQuantity()
  pack_qty?: number;

  @IsOptional()
  @IsEnum(BarcodeKind)
  kind?: BarcodeKind;
}

export class UpdateBarcodeDto {
  @IsOptional()
  @IsQuantity()
  pack_qty?: number;

  @IsOptional()
  @IsEnum(BarcodeKind)
  kind?: BarcodeKind;
}

export class VariantInputDto {
  @IsString()
  @MinLength(2, { message: 'sku must contain at least 2 characters' })
  @MaxLength(100)
  sku: string;

  /** Values of the product type's attributes, keyed by attribute key. */
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  // Initial cost is allowed only before the variant has stock. Every later
  // cost change is posted by the purchasing cost ledger.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  cost_price: number;

  // BR-TYP-100: stocked/non_stock/service/bundle_kit_placeholder.
  // BR-TYP-103: ProductsService rejects a change once the Variant has
  // transaction history — the DTO itself does not know the Variant's
  // history, so it only validates shape here.
  @IsOptional()
  @IsEnum(ItemType)
  item_type?: ItemType;

  // BR-TYP-101: a stocked Variant's Base stock UOM.
  @IsOptional()
  @IsUUID()
  base_uom_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BarcodeDto)
  barcodes?: BarcodeDto[];
}

export class CreateProductDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'name_en must contain at least 2 characters' })
  @MaxLength(200)
  name_en: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  // Deprecated free-text brand — kept for backward compatibility during the
  // BR-CLS-103 migration to `brand_id`. A caller should send `brand_id`
  // going forward; both are accepted so existing integrations don't break.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsUUID()
  brand_id?: string;

  /**
   * WP-008 Phase C (BR-TAX-201, OD-CAT-014): the product-level default tax
   * category. Optional on the wire -- omitted, the service resolves the
   * tenant's STANDARD category rather than leaving the product untaxed.
   */
  @IsOptional()
  @IsUUID()
  tax_category_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  /** Omitted = simple product: one variant, no attributes. */
  @IsOptional()
  @IsUUID()
  product_type_id?: string;

  /** One entry per attribute combination (the client expands its size x colour matrix). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => VariantInputDto)
  variants: VariantInputDto[];
}

export class UpdateProductDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name_en?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name_ar?: string;

  @IsOptional()
  @IsUUID()
  brand_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  tax_category_id?: string;
}

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(ItemType)
  item_type?: ItemType;

  @IsOptional()
  @IsUUID()
  base_uom_id?: string;

  /**
   * W2b: serial / batch tracking. Changeable only while no warehouse holds any
   * of the variant; turning it on needs the plan feature (tracking.serial /
   * tracking.batch); serial needs a unit that allows no decimals.
   */
  @IsOptional()
  @IsEnum(TrackingMode)
  tracking?: TrackingMode;
}
