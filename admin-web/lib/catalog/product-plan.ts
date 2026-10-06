import { productLevelAttributes, type ProductFormState, type VariantRow } from './form-model'
import {
  buildVariantInput, parseProductAttributes, parseRowBarcodes, validateForm,
  type BarcodeInput, type Built, type VariantInput,
} from './product-payload'
import type { AttributeDefinition, AttributeValues, Barcode, ProductType, Uom } from './types'

/** GET /products/:id */
export interface ProductDetail {
  id: string
  name_en: string
  name_ar: string | null
  product_type_id: string | null
  product_type: ProductType | null
  variants: {
    id: string
    sku: string
    label: string
    attributes: AttributeValues
    cost_price?: string | number
    is_active: boolean
    base_uom_id: string | null
    barcodes: (Omit<Barcode, 'pack_qty'> & { pack_qty: number | string })[]
  }[]
}

/** Builds the edit-form state from the server product. */
export function stateFromProduct(product: ProductDetail): ProductFormState {
  const definitions = product.product_type?.attributes ?? []
  const axisValues: Record<string, string[]> = {}
  for (const definition of definitions.filter(item => item.axis)) {
    axisValues[definition.key] = [...new Set(product.variants
      .map(variant => variant.attributes?.[definition.key])
      .filter(value => value !== undefined)
      .map(String))]
  }
  const first = product.variants.find(variant => variant.is_active) ?? product.variants[0]
  const productAttributes: Record<string, string> = {}
  for (const definition of productLevelAttributes(definitions)) {
    const value = first?.attributes?.[definition.key]
    if (value !== undefined) productAttributes[definition.key] = String(value)
  }
  return {
    name_en: product.name_en,
    name_ar: product.name_ar ?? '',
    product_type_id: product.product_type_id ?? '',
    base_uom_id: first?.base_uom_id ?? '',
    productAttributes,
    axisValues,
    variants: product.variants.map((variant): VariantRow => ({
      key: variant.id,
      id: variant.id,
      attributes: variant.attributes ?? {},
      sku: variant.sku,
      cost: variant.cost_price === undefined ? '' : String(variant.cost_price),
      zeroCostConfirmed: true,
      active: variant.is_active,
      barcodes: variant.barcodes.map(barcode => ({
        id: barcode.id, code: barcode.code, pack_qty: String(Number(barcode.pack_qty)), kind: barcode.kind,
      })),
    })),
  }
}

export type EditOperation =
  | { kind: 'patch-product'; body: { name_en?: string; name_ar?: string } }
  | { kind: 'patch-variant'; id: string; body: { sku?: string; attributes?: AttributeValues; base_uom_id?: string } }
  | { kind: 'deactivate-variant'; id: string }
  | { kind: 'add-variant'; body: VariantInput }
  | { kind: 'add-barcode'; variantId: string; body: BarcodeInput }
  | { kind: 'patch-barcode'; id: string; body: { pack_qty: number; kind: BarcodeInput['kind'] } }
  | { kind: 'remove-barcode'; id: string }

interface Buckets {
  removals: EditOperation[]
  edits: EditOperation[]
  additions: EditOperation[]
  errors: string[]
}

const sameValues = (left: AttributeValues, right: AttributeValues) =>
  JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort())

/**
 * The API calls that turn the server product into the edited form. The backend
 * has no bulk edit and no cost/type change on an existing variant, so this
 * diffs field by field: removals first (frees barcode codes), then edits, then additions.
 */
export function planProductEdit(
  original: ProductDetail,
  state: ProductFormState,
  uom?: Uom | null,
): Built<EditOperation[]> {
  const type = original.product_type
  const definitions: AttributeDefinition[] = type?.attributes ?? []
  const activeRows = state.variants.filter(row => row.active)
  const buckets: Buckets = { removals: [], edits: [], additions: [], errors: validateForm(state, type, activeRows) }
  const attributes = parseProductAttributes(definitions, state.productAttributes)
  if ('errors' in attributes) buckets.errors.push(...attributes.errors)
  const productLevel = 'value' in attributes ? attributes.value : {}
  const productLevelKeys = new Set(productLevelAttributes(definitions).map(definition => definition.key))
  const originalById = new Map(original.variants.map(variant => [variant.id, variant]))

  const productBody: { name_en?: string; name_ar?: string } = {}
  if (state.name_en.trim() !== original.name_en) productBody.name_en = state.name_en.trim()
  if (state.name_ar.trim() && state.name_ar.trim() !== (original.name_ar ?? '')) productBody.name_ar = state.name_ar.trim()
  if (Object.keys(productBody).length) buckets.edits.push({ kind: 'patch-product', body: productBody })

  for (const row of state.variants) {
    const before = row.id ? originalById.get(row.id) : undefined
    if (row.id && before) {
      planExistingVariant(row, before, productLevel, productLevelKeys, uom, buckets)
    } else if (row.active) {
      const built = buildVariantInput(row, productLevel, uom)
      if ('errors' in built) buckets.errors.push(...built.errors)
      else buckets.additions.push({ kind: 'add-variant', body: built.value })
    }
  }
  if (buckets.errors.length) return { ok: false, errors: [...new Set(buckets.errors)] }
  return { ok: true, value: [...buckets.removals, ...buckets.edits, ...buckets.additions] }
}

function planExistingVariant(
  row: VariantRow,
  before: ProductDetail['variants'][number],
  productLevel: AttributeValues,
  productLevelKeys: ReadonlySet<string>,
  uom: Uom | null | undefined,
  buckets: Buckets,
) {
  if (before.is_active && !row.active) {
    buckets.removals.push({ kind: 'deactivate-variant', id: before.id })
    return
  }
  if (!row.active) return
  const body: { sku?: string; attributes?: AttributeValues; base_uom_id?: string } = {}
  if (row.sku.trim() !== before.sku) body.sku = row.sku.trim()
  const merged: AttributeValues = { ...before.attributes }
  for (const key of productLevelKeys) delete merged[key]
  Object.assign(merged, productLevel)
  if (!sameValues(merged, before.attributes ?? {})) body.attributes = merged
  if (uom && uom.id !== before.base_uom_id) body.base_uom_id = uom.id
  if (Object.keys(body).length) buckets.edits.push({ kind: 'patch-variant', id: before.id, body })
  planBarcodes(row, before, uom, buckets)
}

function planBarcodes(
  row: VariantRow,
  before: ProductDetail['variants'][number],
  uom: Uom | null | undefined,
  buckets: Buckets,
) {
  const kept = new Set(row.barcodes.map(barcode => barcode.id).filter(Boolean))
  for (const old of before.barcodes) {
    if (!kept.has(old.id)) buckets.removals.push({ kind: 'remove-barcode', id: old.id })
  }
  const parsed = parseRowBarcodes(row, uom)
  buckets.errors.push(...parsed.errors)
  const oldById = new Map(before.barcodes.map(barcode => [barcode.id, barcode]))
  const typed = row.barcodes.filter(barcode => barcode.code.trim())
  typed.forEach((barcode, index) => {
    const next = parsed.barcodes[index]
    if (!next) return
    const old = barcode.id ? oldById.get(barcode.id) : undefined
    if (!old) {
      buckets.additions.push({ kind: 'add-barcode', variantId: before.id, body: next })
    } else if (old.code !== next.code) {
      buckets.removals.push({ kind: 'remove-barcode', id: old.id })
      buckets.additions.push({ kind: 'add-barcode', variantId: before.id, body: next })
    } else if (Number(old.pack_qty) !== next.pack_qty || old.kind !== next.kind) {
      buckets.edits.push({ kind: 'patch-barcode', id: old.id, body: { pack_qty: next.pack_qty, kind: next.kind } })
    }
  })
}
