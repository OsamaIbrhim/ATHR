import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  'aria-required'?: true
}

/**
 * Label + control + hint/error, the one wrapper every form field uses.
 * Pass a render function to wire the label, hint, error and required state to
 * any control (`{props => <input {...props} />}`). A single plain input, select or
 * textarea child is wired automatically; anything else keeps the old wrapping label.
 */
export default function Field({ label, hint, error, required, children, className = '' }: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode | ((props: FieldControlProps) => ReactNode)
  className?: string
}) {
  const id = useId()
  const messageId = `${id}-msg`
  const hasMessage = !!(error || hint)
  const controlProps: FieldControlProps = {
    id,
    'aria-describedby': hasMessage ? messageId : undefined,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  }
  const labelContent = (
    <>
      {label}
      {required && <><span aria-hidden className="ms-0.5 text-red-600">*</span><span className="sr-only"> (مطلوب)</span></>}
    </>
  )
  const message = error
    ? <span id={messageId} role="alert" className="mt-1 flex items-start gap-1 text-sm text-red-700"><span aria-hidden>⚠</span>{error}</span>
    : hint && <span id={messageId} className="mt-1 block text-xs text-gray-600">{hint}</span>

  if (typeof children === 'function') {
    return (
      <div className={className}>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">{labelContent}</label>
        {children(controlProps)}
        {message}
      </div>
    )
  }

  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null
  if (isValidElement(only) && typeof only.type === 'string' && ['input', 'select', 'textarea'].includes(only.type)) {
    return (
      <div className={className}>
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">{labelContent}</label>
        {cloneElement(only as ReactElement<any>, { ...controlProps, 'aria-describedby': controlProps['aria-describedby'] })}
        {message}
      </div>
    )
  }
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{labelContent}</span>
      {children}
      {message}
    </label>
  )
}
