'use client'
import Field from '@/components/ui/Field'
import type { AttributeDefinition } from '@/lib/catalog/types'

/** Product-level (non-axis) attributes of the chosen type; copied to every variant on save. */
export default function TypeAttributeFields({ attributes, values, onChange }: {
  attributes: AttributeDefinition[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {attributes.map(attribute => (
        <Field key={attribute.key} label={attribute.label_ar}>
          {attribute.kind === 'select' ? (
            <select className="select" value={values[attribute.key] ?? ''} onChange={event => onChange(attribute.key, event.target.value)}>
              <option value="">—</option>
              {attribute.options?.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : (
            <input className="input" type={attribute.kind === 'number' ? 'number' : 'text'} step="any"
              value={values[attribute.key] ?? ''} onChange={event => onChange(attribute.key, event.target.value)} />
          )}
        </Field>
      ))}
    </div>
  )
}
