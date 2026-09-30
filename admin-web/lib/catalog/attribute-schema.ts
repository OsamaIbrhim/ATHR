import type { AttributeDefinition, AttributeKind } from './types'

/** Same rules as backend product-type-schema.ts `parseAttributeDefinitions`. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
export const MAX_ATTRIBUTES = 20
export const MAX_TEXT_LENGTH = 100
const KINDS: readonly AttributeKind[] = ['text', 'number', 'select']

const isText = (value: unknown, max = MAX_TEXT_LENGTH): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

/** Client-side validation of an attribute list; returns Arabic messages, empty when valid. */
export function validateAttributeDefinitions(list: readonly AttributeDefinition[]): string[] {
  const errors: string[] = []
  if (list.length > MAX_ATTRIBUTES) errors.push(`الحد الأقصى ${MAX_ATTRIBUTES} خاصية لكل نوع.`)
  const seen = new Set<string>()
  list.forEach((attribute, index) => {
    const at = `الخاصية ${index + 1}`
    if (!KEY_PATTERN.test(attribute.key)) {
      errors.push(`${at}: المفتاح إنجليزي صغير يبدأ بحرف ويتكون من أحرف وأرقام و_ فقط (حتى 40 حرفًا).`)
    } else if (seen.has(attribute.key)) {
      errors.push(`${at}: المفتاح "${attribute.key}" مكرر.`)
    }
    seen.add(attribute.key)
    if (!isText(attribute.label_ar) || !isText(attribute.label_en)) {
      errors.push(`${at}: أدخل الاسم بالعربية والإنجليزية (حتى ${MAX_TEXT_LENGTH} حرف).`)
    }
    if (!KINDS.includes(attribute.kind)) errors.push(`${at}: نوع الخاصية غير صالح.`)
    if (attribute.kind === 'select') {
      const options = attribute.options ?? []
      if (!options.length || !options.every(option => isText(option))) {
        errors.push(`${at}: أضف اختيارًا واحدًا على الأقل لقائمة الاختيارات.`)
      } else if (new Set(options).size !== options.length) {
        errors.push(`${at}: الاختيارات تحتوي على قيمة مكررة.`)
      }
    }
  })
  return errors
}

/** Strips fields the backend rejects (options on a non-select) and trims texts. */
export function normalizeAttributeDefinitions(list: readonly AttributeDefinition[]): AttributeDefinition[] {
  return list.map(attribute => {
    const base = {
      key: attribute.key.trim(),
      label_ar: attribute.label_ar.trim(),
      label_en: attribute.label_en.trim(),
      kind: attribute.kind,
      axis: attribute.axis,
    }
    return attribute.kind === 'select'
      ? { ...base, options: (attribute.options ?? []).map(option => option.trim()) }
      : base
  })
}

export interface ProductTypeInput {
  name_ar: string
  name_en: string
  attributes: AttributeDefinition[]
}

export function validateProductType(input: ProductTypeInput): string[] {
  const errors: string[] = []
  if (!isText(input.name_ar) || !isText(input.name_en)) errors.push('أدخل اسم النوع بالعربية والإنجليزية.')
  return [...errors, ...validateAttributeDefinitions(input.attributes)]
}

export const emptyAttribute = (): AttributeDefinition => ({
  key: '', label_ar: '', label_en: '', kind: 'text', axis: false,
})
