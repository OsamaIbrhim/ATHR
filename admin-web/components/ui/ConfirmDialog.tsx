'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled])'

/**
 * Confirmation of an irreversible step (never window.confirm). Focus starts on
 * the cancel button for the danger tone, Esc closes, Tab stays inside.
 */
export default function ConfirmDialog({
  open, title, children, confirmLabel, cancelLabel = 'رجوع', tone = 'primary', loading, requireCheck, onConfirm, onClose,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'primary' | 'danger'
  loading?: boolean
  requireCheck?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => { if (open) setChecked(false) }, [open])
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    ;(tone === 'danger' ? cancel : confirm).current?.focus()
    return () => previous?.focus?.()
  }, [open, tone])

  if (!open) return null
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (!loading) onClose(); return }
    if (event.key !== 'Tab') return
    const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (!nodes.length) return
    const first = nodes[0]; const last = nodes[nodes.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const blocked = loading || (!!requireCheck && !checked)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 md:items-center md:p-4" onKeyDown={onKeyDown}>
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl md:rounded-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-gray-900">{title}</h2>
        <div className="mt-2 space-y-2 text-sm text-gray-700">{children}</div>
        {requireCheck && (
          <label className="mt-3 flex min-h-11 items-start gap-2 text-sm font-medium text-gray-900">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={e => setChecked(e.target.checked)} />
            {requireCheck}
          </label>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            ref={confirm}
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn'}
            disabled={blocked}
            aria-busy={loading || undefined}
            onClick={onConfirm}
          >
            {loading ? 'جارٍ…' : confirmLabel}
          </button>
          <button ref={cancel} type="button" className="btn-secondary" disabled={loading} onClick={onClose}>{cancelLabel}</button>
        </div>
      </div>
    </div>
  )
}
