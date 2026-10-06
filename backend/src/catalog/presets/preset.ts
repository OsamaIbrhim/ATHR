import type { ScaleBarcodeConfig } from '@athr/domain-core';
import type { AttributeDefinition } from '../product-type-schema';

/**
 * A trade type (clothing, grocery ...) is pure data: the product types and
 * units a new business of that trade starts with, plus tenant settings.
 * Add a trade = add a file exporting a CatalogPreset and register it in
 * `index.ts`. Nothing else in the system knows about trades.
 */
export interface CatalogPreset {
  readonly key: string;
  readonly name_ar: string;
  readonly name_en: string;
  /** Signup `business_type` values that select this preset. */
  readonly business_types: readonly string[];
  readonly product_types: readonly {
    readonly name_ar: string;
    readonly name_en: string;
    readonly attributes: readonly AttributeDefinition[];
  }[];
  readonly uoms: readonly PresetUom[];
  readonly settings?: { readonly scale_barcode?: Partial<ScaleBarcodeConfig> };
}

export interface PresetUom {
  readonly code: string;
  readonly name_ar: string;
  readonly name_en: string;
  /** Decimals a quantity in this unit may carry (piece 0, kg 3). */
  readonly precision: number;
}

export const PIECE: PresetUom = { code: 'pcs', name_ar: 'قطعة', name_en: 'Piece', precision: 0 };
export const KILOGRAM: PresetUom = { code: 'kg', name_ar: 'كجم', name_en: 'Kilogram', precision: 3 };
export const GRAM: PresetUom = { code: 'g', name_ar: 'جرام', name_en: 'Gram', precision: 0 };
