import { describe, expect, it } from 'vitest'
import { addProductToCart, setLineQty } from './cart'

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
  it('adds a pack size or weighed quantity in one scan', () => {
    const pack = addProductToCart([], p(), 20, 10, 0, 'A', 6)
    expect(pack.status).toBe('added')
    expect((pack as any).cart[0].qty).toBe(6)
    expect(addProductToCart(pack.cart, p(), 20, 10, 0, 'A', 6).cart[0].qty).toBe(12)
    expect(addProductToCart(pack.cart, p(), 8, 10, 0, 'A', 6).status).toBe('no_more')
    expect(addProductToCart([], p(), 4, 10, 0, 'A', 6).status).toBe('no_more')
  })

  it('keeps weighed quantities exact and within the unit precision', () => {
    const kg = p({ uom_precision: 3 })
    let cart: any[] = addProductToCart([], kg, 10, 10, 0, 'Tomato', 0.1).cart
    cart = addProductToCart(cart, kg, 10, 10, 0, 'Tomato', 0.2).cart
    expect(cart[0].qty).toBe(0.3)
    expect(addProductToCart([], kg, 10, 10, 0, 'Tomato', 1.2345).status).toBe('invalid_qty')
    // Pieces (precision 0) cannot be split.
    expect(addProductToCart([], p(), 10, 10, 0, 'A', 0.5).status).toBe('invalid_qty')
  })

  it('setLineQty accepts decimals for kg lines and refuses them for pieces', () => {
    const kg = addProductToCart([], p({ uom_precision: 3 }), 5, 10, 0, 'Tomato', 1).cart
    expect(setLineQty(kg, 'v1', 2.25).cart[0].qty).toBe(2.25)
    expect(setLineQty(kg, 'v1', 2.2555).invalid?.variant_id).toBe('v1')
    expect(setLineQty(kg, 'v1', 5.5).limited?.available_qty).toBe(5)
    const pieces = addProductToCart([], p(), 5, 10, 0, 'A', 1).cart
    expect(setLineQty(pieces, 'v1', 1.5).invalid?.variant_id).toBe('v1')
    expect(setLineQty(pieces, 'v1', 1.5).cart[0].qty).toBe(1)
  })
})
