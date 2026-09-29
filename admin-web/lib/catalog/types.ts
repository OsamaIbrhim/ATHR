/** Wire shapes of the generic catalog (mirrors backend/src/catalog/product-type-schema.ts). */
export type AttributeKind = 'text' | 'number' | 'select'
export type BarcodeKind = 'standard' | 'scale_plu'

export interface AttributeDefinition {
  key: string
  label_ar: string
  label_en: string
  kind: AttributeKind
  options?: string[]
  axis: boolean
}

export type AttributeValues = Record<string, string | number>

export interface ProductType {
  id: string
  name_ar: string
  name_en: string
  attributes: AttributeDefinition[]
  is_active: boolean
}

export interface Uom {
  id: string
  code: string
  name_ar: string | null
  name_en: string
  precision: number
  is_active: boolean
}

export interface Barcode {
  id: string
  code: string
  pack_qty: number
  kind: BarcodeKind
}

export const ATTRIBUTE_KIND_LABELS: Record<AttributeKind, string> = {
  text: 'نص',
  number: 'رقم',
  select: 'قائمة اختيارات',
}
