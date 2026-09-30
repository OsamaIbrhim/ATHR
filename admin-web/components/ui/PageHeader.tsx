import Link from 'next/link'
import type { ReactNode } from 'react'

export default function PageHeader({ title, subtitle, back, actions }: {
  title: string
  subtitle?: string
  back?: { href: string; label: string }
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && <Link href={back.href} className="text-xs text-gray-500 hover:text-gray-800">← {back.label}</Link>}
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
