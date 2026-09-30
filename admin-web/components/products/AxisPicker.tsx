'use client'
import Field from '@/components/ui/Field'
import TagInput from '@/components/ui/TagInput'
import type { AttributeDefinition } from '@/lib/catalog/types'

/** Picks the values of each axis attribute; their combinations become the variant matrix. */
export default function AxisPicker({ axes, values, onChange }: {
  axes: AttributeDefinition[]
  values: Record<string, string[]>
  onChange: (key: string, values: string[]) => void
}) {
  return (
    <div className="space-y-3">
      {axes.map(axis => {
        const selected = values[axis.key] ?? []
        return (
          <Field key={axis.key} label={axis.label_ar}
            hint={axis.kind === 'select' ? 'اختر القيم المطلوبة' : 'اكتب القيمة واضغط Enter (أو افصل بفاصلة)'}>
            {axis.kind === 'select' ? (
              <div className="flex flex-wrap gap-1.5">
                {axis.options?.map(option => {
                  const on = selected.includes(option)
                  return (
                    <button key={option} type="button" aria-pressed={on}
                      className={`rounded-full border px-3 py-1 text-sm transition-colors ${on ? 'border-athr bg-athr text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
                      onClick={() => onChange(axis.key, on ? selected.filter(item => item !== option) : [...selected, option])}>
                      {option}
                    </button>
                  )
                })}
              </div>
            ) : (
              <TagInput values={selected} ariaLabel={axis.label_ar} inputMode={axis.kind === 'number' ? 'decimal' : 'text'}
                placeholder={axis.kind === 'number' ? 'مثال: 250' : `أضف ${axis.label_ar}`} onChange={next => onChange(axis.key, next)} />
            )}
          </Field>
        )
      })}
    </div>
  )
}
