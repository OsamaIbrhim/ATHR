import { describe, expect, it } from 'vitest'
import { buildSaleCommand, priceAndCheckSale } from './sale-command'
import { PosSaleValidationError } from './sale-error'
import { validateLocalSaleInput } from './sale-validation'

const branch = '11111111-1111-4111-8111-111111111111'
const variant = '22222222-2222-4222-8222-222222222222'
const variant2 = '66666666-6666-4666-8666-666666666666'
const syncId = '33333333-3333-4333-8333-333333333333'
const sellerId = '55555555-5555-4555-8555-555555555555'

const item = (over: Record<string, unknown> = {}) => ({
  variant_id: variant,
  qty: 1,
  unit_price: 100,
  unit_tax: 14,
  tax_rate: '14.0000',
  tax_mode: 'exclusive',
  sku: 'SKU-1',
  name_ar: 'منتج',
  name_en: 'Product',
  ...over,
})
const sale = (over: Record<string, unknown> = {}) => ({
  sync_id: syncId,
  branch_id: branch,
  seller_id: sellerId,
  local_total: 114,
  payments: [{ method: 'cash', amount: 114, tendered: 150 }],
  items: [item()],
  ...over,
})
const policy = { role: 'cashier', maxDiscountPercent: 10 }
const checked = (raw: unknown) => priceAndCheckSale(validateLocalSaleInput(raw, branch), policy)
const codeOf = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as PosSaleValidationError).code
  }
  return 'none'
}

describe('priceAndCheckSale', () => {
  it('accepts a sale whose total is its lines', () => {
    expect(checked(sale()).total).toBe(114)
  })

  it('accepts a discounted sale priced by the shared arithmetic', () => {
    const raw = sale({
      local_total: 102.6,
      payments: [{ method: 'cash', amount: 102.6 }],
      items: [item({ discount: { type: 'percent', value: 10 } })],
    })
    expect(checked(raw).total).toBe(102.6)
  })

  it('refuses a total that is not the sum of the lines', () => {
    expect(codeOf(() => checked(sale({ local_total: 100 })))).toBe('TOTAL_MISMATCH')
    expect(codeOf(() => checked(sale({ items: [item({ discount: { type: 'percent', value: 10 } })] })))).toBe('TOTAL_MISMATCH')
  })

  it('stops a cashier above the limit and lets a branch manager through', () => {
    const raw = sale({
      local_total: 96.9,
      payments: [{ method: 'cash', amount: 96.9 }],
      items: [item({ discount: { type: 'percent', value: 15 } })],
    })
    expect(codeOf(() => checked(raw))).toBe('DISCOUNT_ABOVE_LIMIT')
    const manager = priceAndCheckSale(validateLocalSaleInput(raw, branch), { role: 'branch_manager', maxDiscountPercent: 10 })
    expect(manager.total).toBe(96.9)
  })

  it('refuses a discount on a catalog row without a tax rate, but not a plain sale', () => {
    const raw = sale({ items: [item({ tax_rate: null, discount: { type: 'amount', value: 5 } })], local_total: 109 })
    expect(codeOf(() => checked(raw))).toBe('DISCOUNT_NEEDS_CATALOG')
    expect(checked(sale({ items: [item({ tax_rate: null })] })).total).toBe(114)
  })
})

describe('buildSaleCommand', () => {
  it('carries the printed number, the payments and the discounts', () => {
    const validated = validateLocalSaleInput(
      sale({
        discount: { type: 'amount', value: 10 },
        items: [item({ discount: { type: 'percent', value: 5 } }), item({ variant_id: variant2, unit_price: 50, unit_tax: 7 })],
        payments: [{ method: 'cash', amount: 100 }, { method: 'card', amount: 2.6 }],
      }),
      branch,
    )
    const command = buildSaleCommand({
      sale: validated,
      payments: validated.payments,
      branchId: branch,
      shiftId: 's',
      cashierId: 'c',
      cashierName: 'Ali',
      sellerName: 'Sara',
      offlineSessionId: 'o',
      terminalSequence: '42',
      invoiceNumber: 'POS1-000042',
      occurredAt: '2026-10-06T10:00:00.000Z',
    })
    expect(command).toMatchObject({
      event_version: 2,
      terminal_sequence: '42',
      invoice_number: 'POS1-000042',
      discount: { type: 'amount', value: 10 },
      payments: [{ method: 'cash', amount: 100 }, { method: 'card', amount: 2.6 }],
    })
    expect(command.items[0]).toMatchObject({ discount: { type: 'percent', value: 5 } })
    expect(command.items[1].discount).toBeUndefined()
    expect(command).not.toHaveProperty('payment_method')
  })
})
