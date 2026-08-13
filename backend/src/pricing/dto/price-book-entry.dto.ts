import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { PriceEntryScopeType, TaxMode } from '@prisma/client';

const SCOPE_TYPE_VALUES = Object.values(PriceEntryScopeType);
const TAX_MODE_VALUES = Object.values(TaxMode);

export class CreatePriceEntryDto {
  @IsUUID()
  price_book_id: string;

  @IsIn(SCOPE_TYPE_VALUES)
  scope_type: PriceEntryScopeType;

  // Required unless scope_type is "global" — checked in PriceBookService,
  // not here, since the rule spans two fields.
  @ValidateIf((dto: CreatePriceEntryDto) => dto.scope_type !== 'global')
  @IsUUID()
  scope_id?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  min_qty?: number;

  // BR-PSL-103: negative is rejected in the service layer, not here, so the
  // error carries the pricing-specific code instead of a generic 400.
  @IsNumber({ maxDecimalPlaces: 2 })
  unit_price: number;

  @IsOptional()
  @IsBoolean()
  allow_zero_price?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax_percent?: number;

  /**
   * WP-008 Phase C (BR-TAX-204): REQUIRED on create, with no default anywhere
   * in the stack. Whether `unit_price` already contains tax is a property of
   * the price context this entry was authored in — "لا يمكن لنفس السعر أن
   * يكون شاملًا وغير شامل دون Scope صريحة". Defaulting it would be a silent
   * ~14% error on every sale the entry prices.
   */
  @IsIn(TAX_MODE_VALUES)
  tax_mode: TaxMode;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  floor_price?: number;
}

export class SupersedePriceEntryDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  unit_price: number;

  @IsOptional()
  @IsBoolean()
  allow_zero_price?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tax_percent?: number;

  /** BR-TAX-204: omit to inherit the superseded entry's mode. */
  @IsOptional()
  @IsIn(TAX_MODE_VALUES)
  tax_mode?: TaxMode;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  floor_price?: number;
}
