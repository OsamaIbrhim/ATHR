import type { AdminUser } from './api'

/**
 * Sidebar entries. `group` is a heading shown once before the first item of a
 * run of entries with the same group; entries without one are top level.
 * requiredPermission() picks the longest matching href, so a nested route
 * (`/products/import`) can need a different permission than its parent.
 */
export const NAV_ITEMS = [
  { href: '/', label: 'لوحة التحكم', permission: 'reports.sales.view' },
  { href: '/sales', label: 'فواتير المبيعات', permission: 'sales.sale.view', group: 'المبيعات' },
  { href: '/products', label: 'المنتجات', permission: 'catalog.product.view', group: 'الكتالوج' },
  { href: '/product-types', label: 'أنواع المنتجات', permission: 'catalog.product.view', group: 'الكتالوج' },
  { href: '/products/import', label: 'استيراد من Excel', permission: 'catalog.product.create', group: 'الكتالوج' },
  { href: '/inventory', label: 'الأرصدة', permission: 'inventory.position.view', group: 'المخزون' },
  { href: '/inventory/low', label: 'منتهية أو بالسالب', permission: 'inventory.position.view', group: 'المخزون' },
  { href: '/inventory/opening', label: 'الرصيد الافتتاحي', permission: 'inventory.adjustment.post', group: 'المخزون' },
  { href: '/inventory/adjustments', label: 'تسويات المخزون', permission: 'inventory.movement.view', group: 'المخزون' },
  { href: '/inventory/counts', label: 'الجرد', permission: 'inventory.adjustment.request', group: 'المخزون' },
  { href: '/transfers', label: 'التحويلات', permission: 'transfer.view', group: 'المخزون' },
  { href: '/customers', label: 'العملاء', permission: 'customer.profile.view' },
  { href: '/purchasing', label: 'المشتريات', permission: 'purchasing.purchase-order.view' },
  { href: '/suppliers', label: 'الموردون', permission: 'supplier.view' },
  { href: '/pricing', label: 'التسعير', permission: 'pricing.price-book.view' },
  { href: '/offers', label: 'العروض', permission: 'promotion.view' },
  { href: '/shifts', label: 'الورديات', permission: 'shift.view' },
  { href: '/terminals', label: 'أجهزة نقاط البيع', permission: 'terminal.view' },
  { href: '/reports', label: 'التقارير', permission: 'reports.sales.view' },
  { href: '/seller-reports', label: 'تقارير البائعين', permission: 'sellers.report.view' },
  { href: '/branches', label: 'الفروع', permission: 'location.create' },
  { href: '/users', label: 'المستخدمون والصلاحيات', permission: 'tenant.membership.view' },
  { href: '/settings', label: 'الإعدادات', permission: 'tenant.settings.manage' },
] as const

export interface NavEntry {
  href: string
  label: string
  permission: Permission
  group?: string
}

/** The same list with a uniform shape (the literal tuple above keeps the permission union). */
export const NAV: readonly NavEntry[] = NAV_ITEMS

/** Keys of the backend permission catalog (identity/permission-catalog.ts) the admin checks. */
export type Permission = typeof NAV_ITEMS[number]['permission']
  | 'catalog.product.update'
  | 'catalog.product.archive'
  | 'catalog.product-type.manage'
  | 'catalog.variant.create'
  | 'catalog.variant.update'
  | 'catalog.uom.view'
  | 'customer.profile.update'
  | 'purchasing.goods-receipt.post'
  | 'terminal.provision'
  | 'location.view'
  | 'inventory.adjustment.approve'
  | 'inventory.position.view-cost'

export function hasPermission(
  user: Pick<AdminUser, 'permissions'> | null | undefined,
  permission: Permission,
) {
  return user?.permissions?.includes(permission) === true
}

export function requiredPermission(pathname: string): Permission | null {
  const route = NAV
    .filter(({ href }) => href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]
  return route?.permission || null
}

/** The nav entry that owns the current path (longest matching href), for the active marker. */
export function activeNavHref(pathname: string): string | null {
  const route = NAV
    .filter(({ href }) => href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]
  return route?.href ?? null
}

export function canAccessPath(
  user: Pick<AdminUser, 'permissions'> | null | undefined,
  pathname: string,
) {
  if (pathname === '/login') return true
  const permission = requiredPermission(pathname)
  return permission === null || hasPermission(user, permission)
}

export function firstAccessiblePath(
  user: Pick<AdminUser, 'permissions'> | null | undefined,
) {
  return NAV.find(({ permission }) => hasPermission(user, permission))?.href || '/login'
}
