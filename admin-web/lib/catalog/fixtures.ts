import type { ProductType } from './types'

export const clothingType: ProductType = {
  id: 'type-clothing', name_ar: 'ملابس', name_en: 'Clothing', is_active: true,
  attributes: [
    { key: 'size', label_ar: 'المقاس', label_en: 'Size', kind: 'text', axis: true },
    { key: 'color', label_ar: 'اللون', label_en: 'Color', kind: 'text', axis: true },
    { key: 'material', label_ar: 'الخامة', label_en: 'Material', kind: 'select', options: ['قطن', 'بوليستر'], axis: false },
    { key: 'weight_g', label_ar: 'الوزن', label_en: 'Weight', kind: 'number', axis: false },
  ],
}
