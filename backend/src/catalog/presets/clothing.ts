import { PIECE, type CatalogPreset } from './preset';

export const clothing: CatalogPreset = {
  key: 'clothing',
  name_ar: 'ملابس',
  name_en: 'Clothing',
  business_types: ['clothing', 'fashion', 'apparel'],
  product_types: [
    {
      name_ar: 'ملابس',
      name_en: 'Clothing',
      attributes: [
        { key: 'size', label_ar: 'المقاس', label_en: 'Size', kind: 'text', axis: true },
        { key: 'color', label_ar: 'اللون', label_en: 'Color', kind: 'text', axis: true },
      ],
    },
  ],
  uoms: [PIECE],
};
