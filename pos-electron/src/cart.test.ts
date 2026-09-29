import { describe, expect, it } from 'vitest'
import { addProductToCart, findExactMatch, setLineQty } from './cart'

const p = (over: any = {}) => ({ id: 'v1', sku: 'A1', qty: 5, selling_price: 10, ...over }) as any

describe('cart helpers', () => {
  it('two rapid adds of the same new item produce one line with qty 2', () => {
    let cart: any[] = []
    for (let i = 0; i < 2; i++) cart = addProductToCart(cart, p(), 5, 10, 0, 'A').cart
    expect(cart).toHaveLength(1)
    expect(cart[0].qty).toBe(2)
  })
  it('enforces stock against the latest cart', () => {
    let cart: any[] = []
    cart = addProductToCart(cart, p(), 1, 10, 0, 'A').cart
    expect(addProductToCart(cart, p(), 1, 10, 0, 'A').status).toBe('no_more')
    expect(addProductToCart([], p(), 0, 10, 0, 'A').status).toBe('unavailable')
  })
  it('setLineQty removes, limits and updates', () => {
    const cart = addProductToCart([], p(), 3, 10, 0, 'A').cart
    expect(setLineQty(cart, 'v1', 0).cart).toHaveLength(0)
    expect(setLineQty(cart, 'v1', 4).limited?.available_qty).toBe(3)
    expect(setLineQty(cart, 'v1', 3).cart[0].qty).toBe(3)
  })
  it('findExactMatch prefers exact code even among several results', () => {
    const rows = [p({ id: 'a', sku: 'AB100' }), p({ id: 'b', sku: 'AB1' }), p({ id: 'c', sku: 'AB10', barcode_ean13: '123' })]
    expect(findExactMatch(rows, 'AB1')?.id).toBe('b')
    expect(findExactMatch(rows, '123')?.id).toBe('c')
    expect(findExactMatch(rows, 'AB')).toBeUndefined()
  })
})
