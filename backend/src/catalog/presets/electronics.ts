import { PIECE, type CatalogPreset } from './preset';

export const electronics: CatalogPreset = {
  key: 'electronics',
  name_ar: 'إلكترونيات',
  name_en: 'Electronics',
  business_types: ['electronics', 'mobiles'],
  product_types: [
    {
      name_ar: 'جهاز إلكتروني',
      name_en: 'Electronic device',
      attributes: [
        { key: 'storage', label_ar: 'السعة', label_en: 'Storage', kind: 'text', axis: true },
        { key: 'color', label_ar: 'اللون', label_en: 'Color', kind: 'text', axis: true },
        { key: 'warranty_months', label_ar: 'الضمان (شهور)', label_en: 'Warranty (months)', kind: 'number', axis: false },
      ],
    },
  ],
  uoms: [PIECE],
};
