import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ItemType } from '@prisma/client';

class VariantIdentityFieldsDto {
  @IsOptional()
  @Matches(/^\d{13}$/)
  barcode_ean13?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode_internal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  style?: string;

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
}

export class CreateProductDto extends VariantIdentityFieldsDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2, {
    message: 'name_en must contain at least 2 characters',
  })
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

  @IsString()
  @MinLength(2, {
    message: 'sku must contain at least 2 characters',
  })
  @MaxLength(100)
  sku: string;

  // Initial cost is allowed only before the variant has stock. Every later
  // cost change is posted by the purchasing cost ledger.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  cost_price: number;
}

export class UpdateVariantDto extends VariantIdentityFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;
}
