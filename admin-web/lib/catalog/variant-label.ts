import type { AttributeDefinition, AttributeValues } from './types'

export const LABEL_SEPARATOR = ' · '

/** "L · أسود": the axis values in the type's attribute order (same as the backend `variantLabel`). */
export function variantLabel(
  definitions: readonly AttributeDefinition[],
  values: AttributeValues,
): string {
  return definitions
    .filter(def => def.axis && values[def.key] !== undefined && values[def.key] !== '')
    .map(def => String(values[def.key]))
    .join(LABEL_SEPARATOR)
}

/** Product name plus the variant label, for selects and tables. */
export function variantTitle(row: {
  label?: string | null
  product?: { name_ar?: string | null; name_en?: string | null } | null
} | null | undefined): string {
  const name = row?.product?.name_ar || row?.product?.name_en || ''
  return [name, row?.label].filter(Boolean).join(' · ')
}
