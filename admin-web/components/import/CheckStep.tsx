'use client'
import { useEffect, useState } from 'react'
import { tabCounts, type ChunkResponse, type RowResult } from '@/lib/import/runner'
import ProgressBar from '@/components/ui/ProgressBar'
import StatCard from '@/components/ui/StatCard'
import { Banner, Tabs } from '@/components/ui/PageStates'
import ResultsTable from './ResultsTable'

type TabKey = 'all' | 'errors' | 'warnings' | 'skipped' | 'outOfPlan'
const FILTER: Record<TabKey, (r: RowResult) => boolean> = {
  all: () => true,
  errors: r => r.status === 'failed',
  warnings: r => r.status === 'ready' && r.warnings.length > 0,
  skipped: r => r.status === 'skipped',
  outOfPlan: r => r.status === 'out_of_plan',
}

export default function CheckStep({ checking, progress, error, results, planLimit, onImport, onDownload, onReupload, onRetry, onBack }: {
  checking: boolean
  progress: { done: number; total: number }
  error: string
  results: RowResult[]
  planLimit: ChunkResponse['plan_limit'] | null
  onImport: () => void
  onDownload: () => void
  onReupload: () => void
  onRetry: () => void
  onBack: () => void
}) {
  const counts = tabCounts(results)
  const [tab, setTab] = useState<TabKey>('all')
  useEffect(() => { if (!checking) setTab(counts.errors ? 'errors' : 'all') }, [checking]) // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) {
    return (
      <div className="card space-y-3" aria-busy="true">
        <p role="status">جارٍ فحص <bdi dir="ltr">{progress.total}</bdi> صف…</p>
        <ProgressBar label="تقدم الفحص" value={progress.done} max={Math.max(1, progress.total)} />
        <p className="text-sm text-gray-600">لن يُكتب شيء الآن؛ هذا فحص فقط.</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-3">
        <Banner tone="danger" action={<button type="button" className="btn-secondary" onClick={onRetry}>إعادة الفحص</button>}>{error}</Banner>
        <button type="button" className="btn-secondary btn-lg" onClick={onBack}>رجوع</button>
      </div>
    )
  }

  const problems = counts.errors + counts.skipped + counts.outOfPlan
  const clean = problems === 0 && counts.warnings === 0
  const limited = planLimit && planLimit.limit !== null && counts.outOfPlan > 0
  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'all' as TabKey, label: 'الكل', count: counts.all },
    { key: 'errors' as TabKey, label: 'أخطاء', count: counts.errors },
    { key: 'warnings' as TabKey, label: 'تنبيهات', count: counts.warnings },
    { key: 'skipped' as TabKey, label: 'سيتم تخطيه', count: counts.skipped },
    ...(counts.outOfPlan ? [{ key: 'outOfPlan' as TabKey, label: 'خارج الباقة', count: counts.outOfPlan }] : []),
  ]

  return (
    <div className="space-y-4">
      {clean && <Banner tone="ok">الملف سليم 100%.</Banner>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="جاهز للاستيراد" value={counts.ready} tone="ok" />
        <StatCard label="سيتم تخطيه" value={counts.skipped} sub="SKU موجود بالفعل" />
        {counts.errors > 0 && <StatCard label="به أخطاء" value={counts.errors} tone="danger" />}
        {counts.outOfPlan > 0 && <StatCard label="خارج حد الباقة" value={counts.outOfPlan} tone="warn" />}
      </div>
      <p className="text-sm text-gray-600">الاستيراد يضيف أصنافًا جديدة فقط ولا يعدّل أسعار أو كميات أصناف موجودة.</p>
      {limited && (
        <Banner tone="warn">
          باقتك تسمح بـ <bdi dir="ltr">{planLimit.limit}</bdi> صنف وعندك <bdi dir="ltr">{planLimit.current}</bdi>. سنستورد أول <bdi dir="ltr">{planLimit.remaining ?? 0}</bdi> صنف فقط، والصفوف الباقية لن تُستورد. لزيادة الحد تواصل معنا لترقية الباقة.
        </Banner>
      )}
      {!clean && (
        <div className="card space-y-3 p-3">
          <Tabs<TabKey> label="تصفية نتائج الفحص" tabs={tabs} value={tab} onChange={setTab} />
          <ResultsTable rows={results.filter(FILTER[tab])} empty="لا توجد مشاكل" />
        </div>
      )}
      {counts.ready === 0 && <p className="text-sm text-gray-700">كل الصفوف بها أخطاء أو موجودة بالفعل.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-lg" disabled={counts.ready === 0} onClick={onImport}>استيراد <bdi dir="ltr">{counts.ready}</bdi> صنف</button>
        <button type="button" className="btn-secondary btn-lg" disabled={problems === 0} onClick={onDownload}>تنزيل ملف الأخطاء</button>
        <button type="button" className="btn-secondary btn-lg" onClick={onReupload}>رفع ملف مصحَّح</button>
        <button type="button" className="btn-secondary btn-lg" onClick={onBack}>رجوع</button>
      </div>
      <p className="text-xs text-gray-600">{counts.ready === 0 ? 'لا توجد صفوف صالحة للاستيراد.' : 'الصفوف التي بها أخطاء لن تُستورد. يمكنك تصحيحها ورفعها لاحقًا.'}</p>
    </div>
  )
}
