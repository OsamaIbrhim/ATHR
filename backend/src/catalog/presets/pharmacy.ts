import { PIECE, type CatalogPreset } from './preset';

export const pharmacy: CatalogPreset = {
  key: 'pharmacy',
  name_ar: 'صيدلية',
  name_en: 'Pharmacy',
  business_types: ['pharmacy', 'drugstore'],
  product_types: [
    {
      name_ar: 'دواء',
      name_en: 'Medicine',
      attributes: [
        { key: 'form', label_ar: 'الشكل', label_en: 'Form', kind: 'select', options: ['أقراص', 'شراب', 'حقن', 'كريم', 'قطرة'], axis: true },
        { key: 'strength', label_ar: 'التركيز', label_en: 'Strength', kind: 'text', axis: true },
      ],
    },
  ],
  uoms: [PIECE, { code: 'box', name_ar: 'علبة', name_en: 'Box', precision: 0 }],
};
