import { MAX_BARCODES_PER_VARIANT } from './barcode'
import { emptyVariantRow, axisAttributes, type VariantRow } from './form-model'
import type { AttributeDefinition, AttributeValues } from './types'
import { variantLabel } from './variant-label'

/** The backend accepts at most this many variants per product. */
export const MAX_VARIANTS = 500

/** Coerces a typed axis value to its stored type (numbers stay numbers). */
export function coerceAxisValue(definition: AttributeDefinition, raw: string): string | number | null {
  const text = raw.trim()
  if (!text) return null
  if (definition.kind === 'number') {
    const value = Number(text)
    return Number.isFinite(value) ? value : null
  }
  return text
}

/** All combinations of the chosen axis values, in the type's attribute order. */
export function cartesian(
  definitions: readonly AttributeDefinition[],
  axisValues: Readonly<Record<string, readonly string[]>>,
): AttributeValues[] {
  let combos: AttributeValues[] = [{}]
  for (const definition of axisAttributes(definitions)) {
    const values = [...new Set(axisValues[definition.key] ?? [])]
      .map(raw => coerceAxisValue(definition, raw))
      .filter((value): value is string | number => value !== null)
    if (!values.length) return []
    combos = combos.flatMap(combo => values.map(value => ({ ...combo, [definition.key]: value })))
  }
  return combos
}

/** SKU proposal "BASE-L-أسود" that the user can overwrite. */
export function suggestSku(base: string, attributes: AttributeValues, definitions: readonly AttributeDefinition[]): string {
  const parts = axisAttributes(definitions).map(def => String(attributes[def.key] ?? '').trim().replace(/\s+/g, '-'))
  return [base.trim(), ...parts].filter(Boolean).join('-')
}

export interface MatrixResult {
  rows: VariantRow[]
  /** True when the combinations exceed MAX_VARIANTS and were truncated. */
  truncated: boolean
}

/**
 * Regenerates the variant rows for the chosen axis values. A row that already
 * exists (same label) keeps its SKU, cost, barcodes and id, so changing the
 * axis values never wipes what the user typed; rows dropped from the matrix
 * disappear unless they exist on the server (those stay, deactivatable).
 */
export function generateMatrix(
  definitions: readonly AttributeDefinition[],
  axisValues: Readonly<Record<string, readonly string[]>>,
  previous: readonly VariantRow[],
  skuBase = '',
): MatrixResult {
  if (!axisAttributes(definitions).length) {
    return { rows: [previous[0] ?? emptyVariantRow()], truncated: false }
  }
  const combos = cartesian(definitions, axisValues)
  const byLabel = new Map(previous.map(row => [variantLabel(definitions, row.attributes), row]))
  const kept = new Set<string>()
  const rows = combos.slice(0, MAX_VARIANTS).map((attributes): VariantRow => {
    const label = variantLabel(definitions, attributes)
    kept.add(label)
    const existing = byLabel.get(label)
    return existing ?? {
      ...emptyVariantRow(label),
      attributes,
      sku: suggestSku(skuBase, attributes, definitions),
    }
  })
  const persisted = previous.filter(row => row.id && !kept.has(variantLabel(definitions, row.attributes)))
  return { rows: [...rows, ...persisted].slice(0, MAX_VARIANTS), truncated: combos.length > MAX_VARIANTS }
}

/** Fills empty SKUs from a new base (never overwrites what the user typed). */
export function fillSkus(
  rows: readonly VariantRow[],
  base: string,
  definitions: readonly AttributeDefinition[],
): VariantRow[] {
  return rows.map(row => row.sku || row.id ? row : { ...row, sku: suggestSku(base, row.attributes, definitions) })
}

export const canAddBarcode = (row: VariantRow) => row.barcodes.length < MAX_BARCODES_PER_VARIANT
