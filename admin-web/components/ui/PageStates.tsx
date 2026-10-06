import type { ReactNode } from 'react'

/** Page-level "no permission" state (spec 0.3). */
export function NoPermission() {
  return (
    <div role="alert" className="card mx-auto mt-10 max-w-md text-center">
      <div className="font-bold text-gray-900">ليس لديك صلاحية لهذه الصفحة</div>
      <p className="mt-1 text-sm text-gray-600">اطلب من مدير المحل أن يمنحك الصلاحية.</p>
    </div>
  )
}

/** Page-level load failure with retry. */
export function LoadFailed({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-2 py-8 text-center">
      <div className="font-bold text-gray-900">تعذر تحميل البيانات</div>
      <p className="text-sm text-gray-600">{message || 'تحقق من الاتصال ثم أعد المحاولة.'}</p>
      <button type="button" className="btn-secondary" onClick={onRetry}>إعادة المحاولة</button>
    </div>
  )
}

/** Inline banner (alert role) in a tone. */
export function Banner({ tone, children, action }: { tone: 'danger' | 'warn' | 'info' | 'ok'; children: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === 'danger' || tone === 'warn' ? 'alert' : 'status'} className={`alert-${tone} flex flex-wrap items-center justify-between gap-2`}>
      <div>{children}</div>
      {action}
    </div>
  )
}

/** Tab bar with counts; real tablist semantics. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { key: T; label: string; count?: number | null }[]
  value: T
  onChange: (key: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto">
      {tabs.map(tab => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === value}
          onClick={() => onChange(tab.key)}
          className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm md:min-h-0 ${tab.key === value ? 'bg-athr font-bold text-white' : 'bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50'}`}
        >
          {tab.label}
          {tab.count !== undefined && tab.count !== null && <span className={`rounded-full px-1.5 text-xs tabular-nums ${tab.key === value ? 'bg-white/20' : 'bg-gray-100'}`}>{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Pager for `{page,total_pages}` lists. */
export function Pager({ page, totalPages, onPage, disabled }: { page: number; totalPages: number; onPage: (p: number) => void; disabled?: boolean }) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-center gap-3 pb-1 text-sm">
      <button type="button" className="btn-secondary" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>السابق</button>
      <span>صفحة <bdi dir="ltr">{page}</bdi> من <bdi dir="ltr">{totalPages}</bdi></span>
      <button type="button" className="btn-secondary" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)}>التالي</button>
    </div>
  )
}
