import type { ReactNode } from 'react'

/** Label + control + hint/error, the one wrapper every form field uses. */
export default function Field({ label, hint, error, required, children, className = '' }: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label}{required && <span className="text-red-600 mr-0.5">*</span>}
      </span>
      {children}
      {error
        ? <span className="mt-1 block text-xs text-red-700">{error}</span>
        : hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  )
}
