import { parseProductCost } from '../product-cost'
import { parseBarcode } from './barcode'
import { productLevelAttributes, type ProductFormState, type VariantRow } from './form-model'
import type { AttributeDefinition, AttributeValues, ProductType, Uom } from './types'
import { MAX_TEXT_LENGTH } from './attribute-schema'
import { variantLabel } from './variant-label'
import { MAX_VARIANTS } from './variant-matrix'

export interface BarcodeInput {
  code: string
  pack_qty: number
  kind: 'standard' | 'scale_plu'
}

export interface VariantInput {
  sku: string
  attributes: AttributeValues
  cost_price: number
  base_uom_id?: string
  barcodes: BarcodeInput[]
}

export interface CreateProductPayload {
  name_en: string
  name_ar?: string
  product_type_id?: string
  variants: VariantInput[]
}

export type Built<T> = { ok: true; value: T } | { ok: false; errors: string[] }

/**
 * Non-axis attribute values are product-level in the form but the backend
 * stores attributes per variant, so they are copied into every variant.
 */
export function parseProductAttributes(
  definitions: readonly AttributeDefinition[],
  typed: Readonly<Record<string, string>>,
): Built<AttributeValues> {
  const values: AttributeValues = {}
  const errors: string[] = []
  for (const definition of productLevelAttributes(definitions)) {
    const raw = (typed[definition.key] ?? '').trim()
    if (!raw) continue
    if (definition.kind === 'number') {
      const number = Number(raw)
      if (!Number.isFinite(number)) errors.push(`${definition.label_ar}: أدخل رقمًا صحيحًا.`)
      else values[definition.key] = number
    } else if (raw.length > MAX_TEXT_LENGTH) {
      errors.push(`${definition.label_ar}: أطول من ${MAX_TEXT_LENGTH} حرف.`)
    } else if (definition.kind === 'select' && !definition.options?.includes(raw)) {
      errors.push(`${definition.label_ar}: اختر قيمة من القائمة.`)
    } else {
      values[definition.key] = raw
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: values }
}

/** Validates the barcodes of one row (format, pack quantity by unit precision). */
export function parseRowBarcodes(row: VariantRow, uom?: Pick<Uom, 'precision'> | null) {
  const errors: string[] = []
  const barcodes: BarcodeInput[] = []
  for (const barcode of row.barcodes) {
    if (!barcode.code.trim()) continue
    const parsed = parseBarcode(barcode, uom?.precision)
    if ('error' in parsed) errors.push(parsed.error)
    else barcodes.push({ code: parsed.code, pack_qty: parsed.pack_qty, kind: parsed.kind })
  }
  return { errors, barcodes }
}

function checkSku(sku: string, seen: Set<string>): string | null {
  const value = sku.trim()
  if (value.length < 2 || value.length > 100) return `SKU "${value}" يجب أن يكون من حرفين إلى 100 حرف.`
  if (seen.has(value)) return `SKU "${value}" مكرر داخل هذا المنتج.`
  seen.add(value)
  return null
}

/** Builds the input of a NEW variant (create, or add-variant on edit); cost is required. */
export function buildVariantInput(
  row: VariantRow,
  productAttributes: AttributeValues,
  uom?: Uom | null,
): Built<VariantInput> {
  const errors: string[] = []
  const cost = parseProductCost(row.cost, row.zeroCostConfirmed)
  if ('error' in cost) errors.push(`${row.sku || 'صنف'}: ${cost.error}`)
  const { errors: barcodeErrors, barcodes } = parseRowBarcodes(row, uom)
  errors.push(...barcodeErrors)
  if (errors.length || 'error' in cost) return { ok: false, errors }
  return {
    ok: true,
    value: {
      sku: row.sku.trim(),
      attributes: { ...productAttributes, ...row.attributes },
      cost_price: cost.value,
      ...(uom ? { base_uom_id: uom.id } : {}),
      barcodes,
    },
  }
}

/** Shared checks for the names, SKUs, labels and barcode uniqueness of the active rows. */
export function validateForm(
  state: ProductFormState,
  type: ProductType | null,
  activeRows: readonly VariantRow[],
): string[] {
  const errors: string[] = []
  if (state.name_en.trim().length < 2) errors.push('أدخل اسم المنتج بالإنجليزية (حرفان على الأقل).')
  if (!activeRows.length) errors.push('أضف صنفًا واحدًا على الأقل.')
  if (!type && activeRows.length > 1) errors.push('المنتج البسيط له صنف واحد فقط.')
  if (activeRows.length > MAX_VARIANTS) errors.push(`الحد الأقصى ${MAX_VARIANTS} صنف لكل منتج.`)
  const skus = new Set<string>()
  for (const row of activeRows) {
    const error = checkSku(row.sku, skus)
    if (error) errors.push(error)
  }
  const definitions = type?.attributes ?? []
  if (definitions.some(definition => definition.axis)) {
    const labels = activeRows.map(row => variantLabel(definitions, row.attributes))
    if (new Set(labels).size !== labels.length) errors.push('يوجد صنفان بنفس تركيبة الخصائص.')
  }
  const codes = new Set<string>()
  for (const code of activeRows.flatMap(row => row.barcodes.map(barcode => barcode.code.trim()).filter(Boolean))) {
    if (codes.has(code)) errors.push(`الباركود ${code} مكرر.`)
    codes.add(code)
  }
  return errors
}

export function buildCreatePayload(
  state: ProductFormState,
  type: ProductType | null,
  uom?: Uom | null,
): Built<CreateProductPayload> {
  const activeRows = state.variants.filter(row => row.active)
  const errors = validateForm(state, type, activeRows)
  const definitions = type?.attributes ?? []
  const attributes = parseProductAttributes(definitions, state.productAttributes)
  if ('errors' in attributes) errors.push(...attributes.errors)
  const variants: VariantInput[] = []
  for (const row of activeRows) {
    const built = buildVariantInput(row, 'value' in attributes ? attributes.value : {}, uom)
    if ('errors' in built) errors.push(...built.errors)
    else variants.push(built.value)
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] }
  return {
    ok: true,
    value: {
      name_en: state.name_en.trim(),
      ...(state.name_ar.trim() ? { name_ar: state.name_ar.trim() } : {}),
      ...(type ? { product_type_id: type.id } : {}),
      variants,
    },
  }
}
