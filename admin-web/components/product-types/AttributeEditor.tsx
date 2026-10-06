'use client'
import Field from '@/components/ui/Field'
import TagInput from '@/components/ui/TagInput'
import { emptyAttribute, MAX_ATTRIBUTES } from '@/lib/catalog/attribute-schema'
import { ATTRIBUTE_KIND_LABELS, type AttributeDefinition, type AttributeKind } from '@/lib/catalog/types'

/** Edits the ordered attribute list of a product type (order = order of the variant label). */
export default function AttributeEditor({ attributes, onChange, disabled }: {
  attributes: AttributeDefinition[]
  onChange: (attributes: AttributeDefinition[]) => void
  disabled?: boolean
}) {
  const update = (index: number, patch: Partial<AttributeDefinition>) =>
    onChange(attributes.map((attribute, position) => (position === index ? { ...attribute, ...patch } : attribute)))
  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= attributes.length) return
    const next = [...attributes]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const setKind = (index: number, kind: AttributeKind) =>
    update(index, kind === 'select' ? { kind, options: attributes[index].options ?? [] } : { kind, options: undefined })

  return (
    <div className="space-y-3">
      {attributes.map((attribute, index) => (
        <div key={index} className="rounded-xl border border-gray-200 bg-gray-50/50 p-3" data-testid="attribute-row">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-athr text-[11px] text-white">{index + 1}</span>
              {attribute.label_ar || 'خاصية جديدة'}
              {attribute.axis && <span className="badge bg-amber-100 text-amber-800">محور متغيرات</span>}
            </div>
            <div className="flex items-center gap-1 text-sm">
              <button type="button" className="px-2 text-gray-500 hover:text-gray-900" aria-label="نقل للأعلى" disabled={disabled || index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="px-2 text-gray-500 hover:text-gray-900" aria-label="نقل للأسفل" disabled={disabled || index === attributes.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="px-2 text-red-600 hover:text-red-800" disabled={disabled} onClick={() => onChange(attributes.filter((_, position) => position !== index))}>حذف</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="المفتاح (إنجليزي)" required>
              <input className="input-sm font-mono" dir="ltr" placeholder="size" value={attribute.key} disabled={disabled}
                onChange={event => update(index, { key: event.target.value })} />
            </Field>
            <Field label="الاسم بالعربية" required>
              <input className="input-sm" placeholder="المقاس" value={attribute.label_ar} disabled={disabled}
                onChange={event => update(index, { label_ar: event.target.value })} />
            </Field>
            <Field label="الاسم بالإنجليزية" required>
              <input className="input-sm" dir="ltr" placeholder="Size" value={attribute.label_en} disabled={disabled}
                onChange={event => update(index, { label_en: event.target.value })} />
            </Field>
            <Field label="النوع">
              <select className="input-sm" value={attribute.kind} disabled={disabled}
                onChange={event => setKind(index, event.target.value as AttributeKind)}>
                {(Object.keys(ATTRIBUTE_KIND_LABELS) as AttributeKind[]).map(kind => (
                  <option key={kind} value={kind}>{ATTRIBUTE_KIND_LABELS[kind]}</option>
                ))}
              </select>
            </Field>
          </div>
          {attribute.kind === 'select' && (
            <div className="mt-3">
              <Field label="الاختيارات" hint="اكتب القيمة واضغط Enter">
                <TagInput values={attribute.options ?? []} onChange={options => update(index, { options })} placeholder="مثال: قطن" ariaLabel="الاختيارات" />
              </Field>
            </div>
          )}
          <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={attribute.axis} disabled={disabled}
              onChange={event => update(index, { axis: event.target.checked })} />
            <span>
              محور للمتغيرات
              <span className="block text-xs text-gray-500">تُكوّن قيمه الأصناف المختلفة للمنتج وتظهر في اسم الصنف (مثل المقاس واللون).</span>
            </span>
          </label>
        </div>
      ))}
      <button type="button" className="btn-secondary w-full text-sm" disabled={disabled || attributes.length >= MAX_ATTRIBUTES}
        onClick={() => onChange([...attributes, emptyAttribute()])}>
        + إضافة خاصية
      </button>
    </div>
  )
}
