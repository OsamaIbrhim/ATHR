import type { AdminUser } from './api'

export const NAV_ITEMS = [
  { href: '/', label: 'لوحة التحكم', permission: 'reports.sales.view' },
  { href: '/sales', label: 'فواتير المبيعات', permission: 'sales.sale.view' },
  { href: '/products', label: 'المنتجات', permission: 'catalog.product.view' },
  { href: '/inventory', label: 'المخزون', permission: 'inventory.position.view' },
  { href: '/customers', label: 'العملاء', permission: 'customer.profile.view' },
  { href: '/purchasing', label: 'المشتريات', permission: 'purchasing.purchase-order.view' },
  { href: '/suppliers', label: 'الموردون', permission: 'supplier.view' },
  { href: '/pricing', label: 'التسعير', permission: 'pricing.price-book.view' },
  { href: '/offers', label: 'العروض', permission: 'promotion.view' },
  { href: '/transfers', label: 'التحويلات', permission: 'transfer.view' },
  { href: '/shifts', label: 'الورديات', permission: 'shift.view' },
  { href: '/terminals', label: 'أجهزة نقاط البيع', permission: 'terminal.view' },
  { href: '/reports', label: 'التقارير', permission: 'reports.sales.view' },
  { href: '/seller-reports', label: 'تقارير البائعين', permission: 'sellers.report.view' },
  { href: '/branches', label: 'الفروع', permission: 'location.create' },
  { href: '/users', label: 'المستخدمون والصلاحيات', permission: 'tenant.membership.view' },
  { href: '/settings', label: 'الإعدادات', permission: 'tenant.settings.manage' },
] as const

/** Keys of the backend permission catalog (identity/permission-catalog.ts) the admin checks. */
export type Permission = typeof NAV_ITEMS[number]['permission']
  | 'catalog.product.update'
  | 'customer.profile.update'
  | 'purchasing.goods-receipt.post'
  | 'terminal.provision'

export function hasPermission(
  user: Pick<AdminUser, 'permissions'> | null | undefined,
  permission: Permission,
) {
  return user?.permissions?.includes(permission) === true
}

export function requiredPermission(pathname: string): Permission | null {
  const route = NAV_ITEMS
    .filter(({ href }) => href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`))
    .sort((left, right) => right.href.length - left.href.length)[0]
  return route?.permission || null
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
  return NAV_ITEMS.find(({ permission }) => hasPermission(user, permission))?.href || '/login'
}
