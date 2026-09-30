'use client'
import { forwardRef } from 'react'
import { sanitizeNumberText } from '@/lib/number-input'

export interface NumberInputProps {
  value: string
  onChange: (value: string) => void
  precision: number
  allowSign?: boolean
  unit?: string
  size?: 'md' | 'lg'
  ariaLabel: string
  error?: string
  selectOnFocus?: boolean
  onEnter?: () => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

/** Decimal box: LTR, Western digits, extra decimals refused, optional unit suffix. */
const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, precision, allowSign, unit, size = 'md', ariaLabel, error, selectOnFocus = true, onEnter, disabled, placeholder, className = '' }, ref,
) {
  return (
    <span className={`relative block ${className}`}>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={e => onChange(sanitizeNumberText(e.target.value, { precision, allowSign }))}
        onFocus={e => { if (selectOnFocus) e.currentTarget.select() }}
        onKeyDown={e => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() } }}
        className={`input input-num ${size === 'lg' ? 'min-h-14 text-2xl' : ''} ${unit ? 'pe-14' : ''}`}
      />
      {unit && <span aria-hidden className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-gray-600">{unit}</span>}
      {error && <span role="alert" className="mt-1 flex items-start gap-1 text-xs text-red-700"><span aria-hidden>⚠</span>{error}</span>}
    </span>
  )
})

export default NumberInput
