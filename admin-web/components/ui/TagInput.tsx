'use client'
import { useState } from 'react'

/** Chips input: Enter or comma adds a value, Backspace on an empty field removes the last one. */
export default function TagInput({ values, onChange, placeholder, ariaLabel, inputMode }: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  ariaLabel?: string
  inputMode?: 'text' | 'decimal'
}) {
  const [draft, setDraft] = useState('')
  const commit = (raw: string) => {
    const additions = raw.split(/[,،\n]/).map(part => part.trim()).filter(Boolean)
    if (additions.length) onChange([...new Set([...values, ...additions])])
    setDraft('')
  }
  return (
    <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-2 py-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40">
      {values.map(value => (
        <span key={value} className="tag">
          {value}
          <button type="button" aria-label={`إزالة ${value}`} className="text-gray-400 hover:text-red-600"
            onClick={() => onChange(values.filter(item => item !== value))}>×</button>
        </span>
      ))}
      <input
        aria-label={ariaLabel}
        inputMode={inputMode}
        className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
        placeholder={values.length ? '' : placeholder}
        value={draft}
        onChange={event => (/[,،]/.test(event.target.value) ? commit(event.target.value) : setDraft(event.target.value))}
        onBlur={() => commit(draft)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commit(draft) }
          else if (event.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1))
        }}
      />
    </div>
  )
}
