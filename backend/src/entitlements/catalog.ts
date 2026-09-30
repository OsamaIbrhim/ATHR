/**
 * The one place a developer adds a feature or limit key. Which plan gets which
 * feature, and how large each limit is, is data (the `Plan` table) that the
 * owner edits from the platform console; this file only says what exists and
 * how to label it (the console and the public pricing page render from it).
 */

export interface CatalogLabel {
  readonly key: string;
  readonly label_ar: string;
  readonly label_en: string;
}

export const FEATURES = [
  { key: 'promotions', label_ar: 'العروض والكوبونات والحزم', label_en: 'Promotions, coupons and bundles' },
  { key: 'uom', label_ar: 'وحدات القياس', label_en: 'Units of measure' },
  { key: 'tracking.serial', label_ar: 'تتبع الأرقام التسلسلية', label_en: 'Serial number tracking' },
  { key: 'tracking.batch', label_ar: 'تتبع الدفعات', label_en: 'Batch tracking' },
  { key: 'api.access', label_ar: 'الوصول عبر API', label_en: 'API access' },
  { key: 'multi_warehouse', label_ar: 'مخازن متعددة', label_en: 'Multiple warehouses' },
] as const satisfies readonly CatalogLabel[];

/** A limit is a maximum count of a resource; a missing or null value means unlimited. */
export const LIMITS = [
  { key: 'branches', label_ar: 'الفروع', label_en: 'Branches' },
  { key: 'terminals', label_ar: 'أجهزة نقاط البيع', label_en: 'POS terminals' },
  { key: 'users', label_ar: 'المستخدمون', label_en: 'Users' },
  { key: 'products', label_ar: 'المنتجات', label_en: 'Products' },
] as const satisfies readonly CatalogLabel[];

export type FeatureKey = (typeof FEATURES)[number]['key'];
export type LimitKey = (typeof LIMITS)[number]['key'];

export const FEATURE_KEYS: readonly string[] = FEATURES.map((feature) => feature.key);
export const LIMIT_KEYS: readonly string[] = LIMITS.map((limit) => limit.key);

export const CATALOG = { features: FEATURES, limits: LIMITS } as const;
