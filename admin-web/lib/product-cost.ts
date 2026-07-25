export type ParsedProductCost =
  | { ok: true; value: number }
  | { ok: false; error: string }

export function parseProductCost(
  input: string,
  zeroConfirmed: boolean,
): ParsedProductCost {
  const normalized = input.trim()
  if (!normalized) return { ok: false, error: 'أدخل سعر التكلفة صراحةً.' }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return { ok: false, error: 'سعر التكلفة يجب أن يكون رقمًا موجبًا أو صفرًا وبحد أقصى منزلتين عشريتين.' }
  }
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0 || value > 9999999999.99) {
    return { ok: false, error: 'سعر التكلفة خارج النطاق المسموح.' }
  }
  if (value === 0 && !zeroConfirmed) {
    return { ok: false, error: 'أكد أن التكلفة الصفرية مقصودة وليست قيمة مفقودة.' }
  }
  return { ok: true, value }
}
