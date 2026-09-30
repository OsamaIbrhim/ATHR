import { describe, expect, it } from 'vitest'
import {
  canAccessPath,
  firstAccessiblePath,
  hasPermission,
  requiredPermission,
} from './permissions'

const readOnlyUser = {
  permissions: ['catalog.product.view', 'customer.profile.view'],
}

describe('admin authorization', () => {
  it('protects both a page and its nested routes with the page permission', () => {
    expect(requiredPermission('/products')).toBe('catalog.product.view')
    expect(requiredPermission('/sales/invoice-id')).toBe('sales.sale.view')
    expect(canAccessPath(readOnlyUser, '/products')).toBe(true)
    expect(canAccessPath(readOnlyUser, '/sales/invoice-id')).toBe(false)
  })

  it('gates the product types page by the catalog view permission and its management by a separate one', () => {
    expect(requiredPermission('/product-types')).toBe('catalog.product.view')
    expect(requiredPermission('/product-types/abc')).toBe('catalog.product.view')
    expect(requiredPermission('/products/new')).toBe('catalog.product.view')
    expect(hasPermission(readOnlyUser, 'catalog.product-type.manage')).toBe(false)
  })

  it('does not grant write actions from a read permission', () => {
    expect(hasPermission(readOnlyUser, 'catalog.product.view')).toBe(true)
    expect(hasPermission(readOnlyUser, 'catalog.product.update')).toBe(false)
    expect(hasPermission(readOnlyUser, 'customer.profile.update')).toBe(false)
  })

  it('selects the first page the user can actually access', () => {
    expect(firstAccessiblePath(readOnlyUser)).toBe('/products')
    expect(firstAccessiblePath({ permissions: [] })).toBe('/login')
  })
})
