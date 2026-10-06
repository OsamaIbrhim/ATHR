'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import { COUNT_STATUS_LABEL, COUNT_STATUS_TONE, scopeLabel, type CountStatus } from '@/lib/counts'
import { formatDate } from '@/lib/format'
import { hasPermission } from '@/lib/permissions'
import { useBranches } from '@/lib/use-branches'
import StartCountDialog from '@/components/inventory/StartCountDialog'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Num from '@/components/ui/Num'
import PageHeader from '@/components/ui/PageHeader'
import { NoPermission, Pager } from '@/components/ui/PageStates'
import ProgressBar from '@/components/ui/ProgressBar'
import StatusBadge from '@/components/ui/StatusBadge'

interface Row {
  id: string; count_number: string; name: string; status: CountStatus; branch: { name_ar?: string } | null
  scope: { type: 'all' | 'category' | 'product_type'; name: string | null }; counted_items: number; items_in_scope: number; last_activity_at: string
}

export default function CountsPage() {
  const user = useSessionUser()
  const router = useRouter()
  const canCount = hasPermission(user, 'inventory.adjustment.request')
  const canStart = canCount && hasPermission(user, 'inventory.adjustment.approve')
  const { branches } = useBranches(user)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Row[]>([])
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  const load = useCallback(async () => {
    if (!canCount) return
    setLoading(true); setError('')
    try { const r = await apiGet(`/inventory/counts?page=${page}&page_size=20`); setRows(r.items ?? []); setPages(r.total_pages ?? 1) }
    catch (e: any) { setError(e.message || 'تعذر تحميل الجرد') }
    finally { setLoading(false) }
  }, [canCount, page])
  useEffect(() => { void load() }, [load])

  if (!canCount) return <NoPermission />
  const startButton = canStart ? <button type="button" className="btn" onClick={() => setStarting(true)}>بدء جرد جديد</button> : undefined
  const progress = (r: Row) => (
    <div className="min-w-32">
      <div className="mb-1 text-xs"><Num value={r.counted_items} /> من <Num value={r.items_in_scope} /> صنف</div>
      <ProgressBar value={r.counted_items} max={Math.max(1, r.items_in_scope)} label="تقدم الجرد" />
    </div>
  )
  const badge = (r: Row) => <StatusBadge tone={COUNT_STATUS_TONE[r.status]}>{COUNT_STATUS_LABEL[r.status]}</StatusBadge>
  const columns: Column<Row>[] = [
    { header: 'الاسم', cell: r => <Link href={`/inventory/counts/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.name}</Link> },
    { header: 'الفرع', cell: r => r.branch?.name_ar ?? '—' },
    { header: 'النطاق', cell: r => scopeLabel(r.scope) },
    { header: 'التقدم', cell: progress },
    { header: 'الحالة', cell: badge },
    { header: 'آخر نشاط', cell: r => <bdi dir="ltr">{formatDate(r.last_activity_at, { time: true })}</bdi> },
    { header: '', key: 'go', cell: r => r.status === 'open' ? <Link className="btn-secondary btn-sm" href={`/inventory/counts/${r.id}`}>متابعة العدّ</Link> : null },
  ]
  return (
    <div className="space-y-4">
      <PageHeader title="الجرد" subtitle="قارن المخزون الفعلي بما في النظام وصحّح الفروق." actions={startButton} />
      <div className="card p-2">
        <DataTable
          columns={columns} rows={rows} rowKey={r => r.id} loading={loading} caption="عمليات الجرد"
          error={error ? { message: error, onRetry: load } : undefined}
          empty={{ title: 'لا يوجد جرد بعد', hint: 'ابدأ جردًا لتتأكد أن أرقام المخزون تطابق الرف.', action: startButton }}
          mobileCard={r => (
            <Link href={`/inventory/counts/${r.id}`} className="block space-y-2">
              <div className="flex items-start justify-between gap-2"><div className="font-medium">{r.name}</div>{badge(r)}</div>
              <div className="text-sm text-gray-600">{r.branch?.name_ar} · {scopeLabel(r.scope)}</div>
              {progress(r)}
              {r.status === 'open' && <span className="btn-secondary btn-sm w-full">متابعة العدّ</span>}
            </Link>
          )}
        />
        <Pager page={page} totalPages={pages} onPage={setPage} disabled={loading} />
      </div>
      {starting && <StartCountDialog branches={branches} defaultBranchId={user?.branch_id ?? ''} onClose={() => setStarting(false)} onStarted={id => router.push(`/inventory/counts/${id}`)} />}
    </div>
  )
}
