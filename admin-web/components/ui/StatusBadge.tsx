import type { ReactNode } from 'react'

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

const CLASS: Record<Tone, string> = {
  ok: 'badge-ok', warn: 'badge-warn', danger: 'badge-danger', info: 'badge-info', neutral: 'badge-neutral',
}
const ICON: Record<Tone, string> = { ok: '✓', warn: '!', danger: '✕', info: 'i', neutral: '•' }

/** Coloured pill plus words (and a glyph), so colour is never the only signal. */
export default function StatusBadge({ tone, children, icon = true }: { tone: Tone; children: ReactNode; icon?: boolean }) {
  return (
    <span className={CLASS[tone]}>
      {icon && <span aria-hidden className="text-[10px] leading-none">{ICON[tone]}</span>}
      {children}
    </span>
  )
}
