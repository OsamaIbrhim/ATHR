import { describe, expect, it } from 'vitest'
import { clothingType } from './fixtures'
import { planProductEdit, stateFromProduct, type ProductDetail } from './product-plan'
import { applyPlan } from './product-save'

const detail = (): ProductDetail => ({
  id: 'p1', name_en: 'T-shirt', name_ar: null, product_type_id: clothingType.id, product_type: clothingType,
  variants: [
    {
      id: 'v1', sku: 'TS-S', label: 'S · red', attributes: { size: 'S', color: 'red', material: 'قطن' },
      cost_price: '40.00', is_active: true, base_uom_id: null,
      barcodes: [{ id: 'b1', code: '111', pack_qty: '1.000', kind: 'standard' }],
    },
    {
      id: 'v2', sku: 'TS-M', label: 'M · red', attributes: { size: 'M', color: 'red', material: 'قطن' },
      cost_price: '40.00', is_active: true, base_uom_id: null, barcodes: [],
    },
  ],
})

describe('edit plan', () => {
  it('is empty when nothing changed', () => {
    const p = detail()
    expect(planProductEdit(p, stateFromProduct(p))).toEqual({ ok: true, value: [] })
  })

  it('loads axis values, product attributes and barcodes into the form', () => {
    const state = stateFromProduct(detail())
    expect(state.axisValues).toEqual({ size: ['S', 'M'], color: ['red'] })
    expect(state.productAttributes).toEqual({ material: 'قطن' })
    expect(state.variants[0].barcodes[0]).toMatchObject({ id: 'b1', pack_qty: '1' })
  })

  it('patches name, sku and merged attributes only where changed', () => {
    const p = detail()
    const s = stateFromProduct(p)
    s.name_en = 'Tee'
    s.variants[0].sku = 'TS-S2'
    s.productAttributes.weight_g = '200'
    const plan = planProductEdit(p, s)
    if (!('value' in plan)) throw new Error('expected ok')
    expect(plan.value).toContainEqual({ kind: 'patch-product', body: { name_en: 'Tee' } })
    expect(plan.value).toContainEqual({
      kind: 'patch-variant', id: 'v1',
      body: { sku: 'TS-S2', attributes: { size: 'S', color: 'red', material: 'قطن', weight_g: 200 } },
    })
    expect(plan.value.filter(op => op.kind === 'patch-variant')).toHaveLength(2)
  })

  it('orders removals before edits before additions, and replaces a changed code', () => {
    const p = detail()
    const s = stateFromProduct(p)
    s.variants[1].active = false
    s.variants[0].barcodes[0].code = '222'
    s.variants[0].barcodes.push({ code: '333', pack_qty: '6', kind: 'standard' })
    s.variants.push({
      key: 'new', attributes: { size: 'L', color: 'red' }, sku: 'TS-L', cost: '45',
      zeroCostConfirmed: false, barcodes: [], active: true,
    })
    const plan = planProductEdit(p, s)
    if (!('value' in plan)) throw new Error('expected ok')
    expect(plan.value.map(op => op.kind)).toEqual([
      'remove-barcode', 'deactivate-variant', 'add-barcode', 'add-barcode', 'add-variant',
    ])
    const added = plan.value.find(op => op.kind === 'add-variant')
    expect(added).toMatchObject({ body: { sku: 'TS-L', cost_price: 45, attributes: { material: 'قطن', size: 'L', color: 'red' } } })
  })

  it('patches a barcode pack quantity in place', () => {
    const p = detail()
    const s = stateFromProduct(p)
    s.variants[0].barcodes[0].pack_qty = '12'
    const plan = planProductEdit(p, s)
    expect(plan).toEqual({ ok: true, value: [{ kind: 'patch-barcode', id: 'b1', body: { pack_qty: 12, kind: 'standard' } }] })
  })

  it('reports invalid input instead of planning', () => {
    const p = detail()
    const s = stateFromProduct(p)
    s.variants[0].barcodes[0].code = 'bad code'
    expect(planProductEdit(p, s)).toMatchObject({ ok: false })
  })

  it('applies a plan in order and stops at the first failure', async () => {
    const calls: string[] = []
    const api = {
      post: async (path: string) => { calls.push(`POST ${path}`) },
      patch: async (path: string) => { calls.push(`PATCH ${path}`); throw new Error('boom') },
      del: async (path: string) => { calls.push(`DELETE ${path}`) },
    }
    const result = await applyPlan(api, 'p1', [
      { kind: 'deactivate-variant', id: 'v2' },
      { kind: 'patch-product', body: { name_en: 'X' } },
      { kind: 'remove-barcode', id: 'b1' },
    ])
    expect(calls).toEqual(['DELETE /products/variants/v2', 'PATCH /products/p1'])
    expect(result).toEqual({ done: 1, total: 3, error: 'boom' })
  })
})
