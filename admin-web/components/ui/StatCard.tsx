import type { ReactNode } from 'react'

const TONE = {
  neutral: 'text-gray-900',
  ok: 'text-green-700',
  warn: 'text-amber-800',
  danger: 'text-red-700',
}

export default function StatCard({ label, value, sub, tone = 'neutral', loading, large }: {
  label: string
  value: ReactNode
  sub?: string
  tone?: keyof typeof TONE
  loading?: boolean
  large?: boolean
}) {
  return (
    <div className="card" aria-busy={loading || undefined}>
      <div className="text-sm text-gray-600">{label}</div>
      {loading
        ? <div className="mt-2 h-8 w-20 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
        : <div className={`mt-1 font-bold tabular-nums ${large ? 'text-3xl' : 'text-2xl'} ${TONE[tone]}`}>{value}</div>}
      {sub && <div className="mt-0.5 text-xs text-gray-600">{sub}</div>}
    </div>
  )
}
