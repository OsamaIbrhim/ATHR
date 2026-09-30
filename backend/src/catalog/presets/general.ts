import { PIECE, type CatalogPreset } from './preset';

/** The fallback for any trade without its own preset: simple products only. */
export const general: CatalogPreset = {
  key: 'general',
  name_ar: 'تجارة عامة',
  name_en: 'General retail',
  business_types: ['general', 'retail'],
  product_types: [],
  uoms: [PIECE],
};
