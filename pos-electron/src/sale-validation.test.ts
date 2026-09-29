import { describe, expect, it } from 'vitest'
import {
  PosSaleValidationError,
  saleItemCommand,
  validateLocalSaleInput,
} from '../electron/sale-validation'

const branch =
  '11111111-1111-4111-8111-111111111111'
const variant =
  '22222222-2222-4222-8222-222222222222'
const syncId =
  '33333333-3333-4333-8333-333333333333'
const sellerId =
  '55555555-5555-4555-8555-555555555555'

function sale(overrides: Record<string, unknown> = {}) {
  return {
    sync_id: syncId,
    branch_id: branch,
    seller_id: sellerId,
    payment_method: 'cash',
    local_total: 114,
    items: [
      {
        variant_id: variant,
        qty: 1,
        unit_price: 100,
        unit_tax: 14,
        sku: 'SKU-1',
        name_ar: 'منتج',
        name_en: 'Product',
        label: 'M · Black',
      },
    ],
    ...overrides,
  }
}

describe('local sale IPC validation', () => {
  it('normalizes a complete immutable sale command', () => {
    expect(
      validateLocalSaleInput(sale(), branch),
    ).toMatchObject({
      syncId,
      branchId: branch,
      sellerId,
      paymentMethod: 'cash',
      localTotal: 114,
    })
  })

  it('keeps the variant label and accepts decimal quantities up to 3 places', () => {
    const weighed = validateLocalSaleInput(
      sale({ items: [{ ...sale().items[0], qty: 1.235 }] }),
      branch,
    )
    expect(weighed.items[0]).toMatchObject({ qty: 1.235, label: 'M · Black' })
  })

  it('sends the label snapshot and no legacy size/color fields', () => {
    const { items } = validateLocalSaleInput(sale(), branch)
    const command = saleItemCommand(items[0])
    expect(command).toEqual({
      variant_id: variant,
      qty: 1,
      unit_price: 100,
      unit_tax: 14,
      sku_snapshot: 'SKU-1',
      name_ar_snapshot: 'منتج',
      name_en_snapshot: 'Product',
      variant_label_snapshot: 'M · Black',
    })
    expect(command).not.toHaveProperty('size_snapshot')
    expect(command).not.toHaveProperty('color_snapshot')
    const unlabelled = validateLocalSaleInput(
      sale({ items: [{ ...sale().items[0], label: '' }] }),
      branch,
    )
    expect(saleItemCommand(unlabelled.items[0]).variant_label_snapshot).toBeUndefined()
  })

  it('rejects quantities the server would reject', () => {
    for (const qty of [0, 0.0005, 1.2345, Number.NaN, 100_000_000]) {
      expect(() =>
        validateLocalSaleInput(sale({ items: [{ ...sale().items[0], qty }] }), branch),
      ).toThrow(PosSaleValidationError)
    }
  })

  it('requires a seller attribution', () => {
    expect(() =>
      validateLocalSaleInput(sale({ seller_id: '' }), branch),
    ).toThrow('اختر البائع')
  })

  it('rejects negative quantities and duplicate variants', () => {
    expect(() =>
      validateLocalSaleInput(
        sale({
          items: [
            {
              ...sale().items[0],
              qty: -1,
            },
          ],
        }),
        branch,
      ),
    ).toThrow(PosSaleValidationError)

    expect(() =>
      validateLocalSaleInput(
        sale({
          items: [
            sale().items[0],
            sale().items[0],
          ],
        }),
        branch,
      ),
    ).toThrow('تكرار')
  })

  it('rejects another branch and incomplete historical item data', () => {
    expect(() =>
      validateLocalSaleInput(
        sale({
          branch_id:
            '44444444-4444-4444-8444-444444444444',
        }),
        branch,
      ),
    ).toThrow('غير مسجل')
    expect(() =>
      validateLocalSaleInput(
        sale({
          items: [
            {
              ...sale().items[0],
              sku: '',
            },
          ],
        }),
        branch,
      ),
    ).toThrow('لقطة سعر')
  })
})
