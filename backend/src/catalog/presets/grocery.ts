import { GRAM, KILOGRAM, PIECE, type CatalogPreset } from './preset';

export const grocery: CatalogPreset = {
  key: 'grocery',
  name_ar: 'بقالة وسوبر ماركت',
  name_en: 'Grocery',
  business_types: ['grocery', 'supermarket'],
  product_types: [
    {
      name_ar: 'مواد غذائية',
      name_en: 'Food item',
      attributes: [{ key: 'pack_size', label_ar: 'العبوة', label_en: 'Pack size', kind: 'text', axis: true }],
    },
  ],
  uoms: [PIECE, KILOGRAM, GRAM],
  // Weighed items are sold through the scale's labels.
  settings: { scale_barcode: { enabled: true } },
};
