import type { AttributeDefinition, AttributeValues, BarcodeKind } from './types'

/** Editable state of the product form. Numbers stay strings until the payload is built. */
export interface BarcodeRow {
  id?: string
  code: string
  pack_qty: string
  kind: BarcodeKind
}

export interface VariantRow {
  /** Stable React key; the variant label for generated rows. */
  key: string
  /** Set for a variant that already exists on the server. */
  id?: string
  attributes: AttributeValues
  sku: string
  cost: string
  zeroCostConfirmed: boolean
  barcodes: BarcodeRow[]
  active: boolean
}

export interface ProductFormState {
  name_en: string
  name_ar: string
  product_type_id: string
  base_uom_id: string
  /** Non-axis attribute values as typed (applied to every variant). */
  productAttributes: Record<string, string>
  /** Chosen values per axis attribute key. */
  axisValues: Record<string, string[]>
  variants: VariantRow[]
}

export const emptyVariantRow = (key = 'simple'): VariantRow => ({
  key, attributes: {}, sku: '', cost: '', zeroCostConfirmed: false, barcodes: [], active: true,
})

export const emptyBarcodeRow = (): BarcodeRow => ({ code: '', pack_qty: '1', kind: 'standard' })

export const axisAttributes = (definitions: readonly AttributeDefinition[]) =>
  definitions.filter(definition => definition.axis)

export const productLevelAttributes = (definitions: readonly AttributeDefinition[]) =>
  definitions.filter(definition => !definition.axis)
