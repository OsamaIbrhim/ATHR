'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { RowResult, Tally } from '@/lib/import/runner'
import ProgressBar from '@/components/ui/ProgressBar'
import StatCard from '@/components/ui/StatCard'
import { Banner } from '@/components/ui/PageStates'
import ResultsTable from './ResultsTable'

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Running({ progress, tally, startedAt, error, stopped, onStop, onResume, onFinish }: {
  progress: { done: number; total: number }
  tally: Tally
  startedAt: number
  error: { chunk: number; message: string } | null
  stopped: boolean
  onStop: () => void
  onResume: () => void
  onFinish: () => void
}) {
  const [now, setNow] = useState(Date.now())
  const paused = !!error || stopped
  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [paused])
  return (
    <div className="card space-y-4">
      <ProgressBar label="تقدم الاستيراد" value={progress.done} max={Math.max(1, progress.total)} />
      <p role="status">تم استيراد <bdi dir="ltr">{progress.done}</bdi> من <bdi dir="ltr">{progress.total}</bdi></p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="تمت إضافته" value={tally.created} tone="ok" />
        <StatCard label="تم تخطيه" value={tally.skipped} />
        <StatCard label="فشل" value={tally.failed} tone={tally.failed ? 'danger' : 'neutral'} />
        <StatCard label="الوقت" value={<bdi dir="ltr">{elapsed(now - startedAt)}</bdi>} />
      </div>
      {error && (
        <Banner tone="danger" action={<div className="flex gap-2"><button type="button" className="btn" onClick={onResume}>متابعة من حيث توقفنا</button><button type="button" className="btn-secondary" onClick={onFinish}>إنهاء هنا</button></div>}>
          انقطع الاتصال عند الدفعة <bdi dir="ltr">{error.chunk}</bdi>.
        </Banner>
      )}
      {stopped && !error && (
        <Banner tone="info" action={<div className="flex gap-2"><button type="button" className="btn" onClick={onResume}>متابعة</button><button type="button" className="btn-secondary" onClick={onFinish}>إنهاء هنا</button></div>}>
          توقف الاستيراد بعد الدفعة الحالية. ما تم استيراده باقٍ.
        </Banner>
      )}
      {!paused && (
        <>
          <p className="text-sm text-gray-700">لا تغلق هذه الصفحة حتى ينتهي الاستيراد.</p>
          <button type="button" className="btn-secondary" onClick={onStop}>إيقاف بعد الدفعة الحالية</button>
        </>
      )}
    </div>
  )
}

function Done({ tally, failedRows, excluded, branchName, withoutQty, onDownload, onAnother }: {
  tally: Tally
  failedRows: RowResult[]
  excluded: number
  branchName: string
  withoutQty: number
  onDownload: () => void
  onAnother: () => void
}) {
  const nothing = tally.created === 0
  const problems = tally.failed + excluded
  return (
    <div className="space-y-4">
      {nothing
        ? <Banner tone={problems > 0 ? 'warn' : 'info'}>{problems > 0 ? <>لم يُضف أي صنف. <bdi dir="ltr">{problems}</bdi> صف به أخطاء.</> : 'لم يُضف أي صنف جديد'}</Banner>
        : problems > 0
          ? <Banner tone="warn">تم استيراد <bdi dir="ltr">{tally.created}</bdi> صنف، و<bdi dir="ltr">{problems}</bdi> صف لم يُستورد بسبب أخطاء</Banner>
          : <Banner tone="ok">تم الاستيراد بنجاح</Banner>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="إجمالي الصفوف" value={tally.created + tally.skipped + problems} />
        <StatCard label="تمت إضافته" value={tally.created} tone="ok" />
        <StatCard label="تم تخطيه — SKU موجود" value={tally.skipped} />
        {problems > 0 && <StatCard label="لم يُستورد (أخطاء)" value={problems} tone="danger" />}
      </div>
      {tally.openingQuantities > 0 && <p className="text-sm">سُجّلت كميات افتتاحية لـ <bdi dir="ltr">{tally.openingQuantities}</bdi> صنف في {branchName}.</p>}
      {failedRows.length > 0 && (
        <div className="card space-y-3 p-3">
          <ResultsTable rows={failedRows} empty="لا توجد أخطاء" />
          <button type="button" className="btn-secondary" onClick={onDownload}>تنزيل ملف الأخطاء</button>
        </div>
      )}
      {withoutQty > 0 && (
        <Banner tone="info" action={<Link className="btn-secondary" href="/inventory/opening">الرصيد الافتتاحي</Link>}>
          <bdi dir="ltr">{withoutQty}</bdi> صنف بلا كمية. سجّلها من شاشة الرصيد الافتتاحي.
        </Banner>
      )}
      <div className="flex flex-wrap gap-2">
        <Link className="btn btn-lg" href="/products">عرض المنتجات</Link>
        <button type="button" className="btn-secondary btn-lg" onClick={onAnother}>استيراد ملف آخر</button>
      </div>
    </div>
  )
}

export default function RunStep(props: {
  running: boolean
  progress: { done: number; total: number }
  tally: Tally
  startedAt: number
  error: { chunk: number; message: string } | null
  stopped: boolean
  failedRows: RowResult[]
  excluded: number
  branchName: string
  withoutQty: number
  onStop: () => void
  onResume: () => void
  onFinish: () => void
  onDownload: () => void
  onAnother: () => void
}) {
  return props.running ? <Running {...props} /> : <Done {...props} />
}
