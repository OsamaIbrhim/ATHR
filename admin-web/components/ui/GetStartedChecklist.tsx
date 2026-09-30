'use client'
import Link from 'next/link'
import type { ChecklistStep } from '@/lib/checklist'
import { summarizeChecklist } from '@/lib/checklist'
import { hasPermission } from '@/lib/permissions'
import type { AdminUser } from '@/lib/api'
import ProgressBar from './ProgressBar'

export default function GetStartedChecklist({ steps, user, onHide, loading }: {
  steps: ChecklistStep[]
  user: AdminUser | null
  onHide: () => void
  loading?: boolean
}) {
  if (loading) {
    return (
      <section className="card min-h-[22rem]" aria-busy="true" aria-label="ابدأ تشغيل محلك">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
        <div className="mt-4 space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none" />)}</div>
      </section>
    )
  }
  const summary = summarizeChecklist(steps)
  if (summary.allRequiredDone) {
    return (
      <section className="card flex flex-wrap items-center justify-between gap-2" aria-label="ابدأ تشغيل محلك">
        <p className="font-medium text-green-800"><span aria-hidden>✓ </span>كل شيء جاهز — تم تجهيز محلك</p>
        <button type="button" className="btn-link" onClick={onHide}>إخفاء</button>
      </section>
    )
  }
  return (
    <section className="card" aria-label="ابدأ تشغيل محلك">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-gray-900">ابدأ تشغيل محلك</h2>
          <p className="mb-2 text-sm text-gray-600">{summary.done} من {summary.total} خطوات</p>
          <ProgressBar value={summary.done} max={summary.total} label="تقدم تجهيز المحل" />
        </div>
        <button type="button" className="btn-link" onClick={onHide}>إخفاء</button>
      </div>
      <ol className="mt-4 divide-y divide-gray-100">
        {steps.map((step, index) => {
          const allowed = hasPermission(user, step.permission)
          const first = step.key === summary.firstPendingKey
          return (
            <li key={step.key} className="flex flex-wrap items-center gap-3 py-3">
              <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step.done ? 'bg-green-700 text-white' : 'bg-gray-200 text-gray-800'}`}>
                {step.done ? '✓' : index + 1}
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{step.title}</span>
                  {step.optional && <span className="badge-neutral">اختياري</span>}
                  <span className="text-xs font-medium text-gray-600">{step.done ? 'تم' : first ? 'التالي' : ''}</span>
                </div>
                <p className="text-sm text-gray-600">{step.hint}</p>
                {!step.done && step.pendingNote && <p className="text-sm font-medium text-amber-800">{step.pendingNote}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {step.done
                  ? allowed && <Link href={step.href} className="btn-link">عرض</Link>
                  : allowed
                    ? (
                      <>
                        {step.secondary && <Link href={step.secondary.href} className="btn-link">{step.secondary.label}</Link>}
                        <Link href={step.href} className={first ? 'btn' : 'btn-secondary'}>{step.actionLabel}</Link>
                      </>
                    )
                    : <span className="text-sm text-gray-600">يقوم بها مدير المحل</span>}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
