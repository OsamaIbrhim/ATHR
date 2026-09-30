import Link from 'next/link'
import type { ReactNode } from 'react'

export default function PageHeader({ title, subtitle, back, actions, badge }: {
  title: string
  subtitle?: string
  back?: { href: string; label: string }
  actions?: ReactNode
  badge?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {/* In RTL "back" points right, which is the start side, so the arrow comes first. */}
        {back && <Link href={back.href} className="inline-flex min-h-11 items-center gap-1 text-sm text-gray-600 hover:text-gray-900 md:min-h-0"><span aria-hidden>→</span>{back.label}</Link>}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="mt-0.5 text-sm text-gray-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
