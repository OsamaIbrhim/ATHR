/**
 * The text that tells variants of one product apart. Older data (sales and
 * catalog rows from POS <= 1.5) only has size and color, so build the same
 * "size · color" label the server derives now.
 */
export function variantLabel(source: {
  label?: string | null
  size?: string | null
  color?: string | null
}): string {
  const label = String(source.label || '').trim()
  if (label) return label
  return [source.size, source.color]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' · ')
}
