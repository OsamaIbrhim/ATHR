'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import { STATUS_LABEL, STATUS_TONE, type AdjustmentStatus } from '@/lib/adjustments'
import { formatDate } from '@/lib/format'
import { hasPermission } from '@/lib/permissions'
import { useBranches } from '@/lib/use-branches'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Field from '@/components/ui/Field'
import Num from '@/components/ui/Num'
import PageHeader from '@/components/ui/PageHeader'
import { NoPermission, Pager, Tabs } from '@/components/ui/PageStates'
import StatusBadge from '@/components/ui/StatusBadge'

type Tab = 'all' | AdjustmentStatus
interface Row {
  id: string; adjustment_number: string; status: AdjustmentStatus; branch: { id: string; name_ar?: string } | null
  created_at: string; created_by?: { name?: string } | string | null; line_count: number; net_value?: string | null
}
interface ListResponse { items: Row[]; page: number; total_pages: number; status_counts: Record<Tab, number> }

const creator = (row: Row) => (typeof row.created_by === 'string' ? row.created_by : row.created_by?.name ?? '—')
const badge = (status: AdjustmentStatus) => (
  <StatusBadge tone={STATUS_TONE[status]}>{status === 'cancelled' ? <s>{STATUS_LABEL[status]}</s> : STATUS_LABEL[status]}</StatusBadge>
)

export default function AdjustmentsPage() {
  const user = useSessionUser()
  const allowed = hasPermission(user, 'inventory.movement.view')
  const canRequest = hasPermission(user, 'inventory.adjustment.request')
  const canApprove = hasPermission(user, 'inventory.adjustment.approve')
  const canPost = hasPermission(user, 'inventory.adjustment.post')
  const showValue = hasPermission(user, 'inventory.position.view-cost')
  const { branches } = useBranches(user)
  const [tab, setTab] = useState<Tab | null>(null)
  const [branchId, setBranchId] = useState('')
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The tab that needs this user's action is the default one.
  const activeTab: Tab = tab ?? (canApprove ? 'draft' : canPost ? 'approved' : 'all')
  const load = useCallback(async () => {
    if (!allowed) return
    setLoading(true); setError('')
    const params = new URLSearchParams({ page: String(page), page_size: '20' })
    if (activeTab !== 'all') params.set('status', activeTab)
    if (branchId) params.set('branch_id', branchId)
    if (applied) params.set('q', applied)
    try { setData(await apiGet(`/inventory/adjustments?${params}`)) }
    catch (e: any) { setError(e.message || 'تعذر تحميل التسويات') }
    finally { setLoading(false) }
  }, [allowed, page, activeTab, branchId, applied])
  useEffect(() => { void load() }, [load])

  if (!allowed) return <NoPermission />
  const counts = data?.status_counts
  const tabs = (['all', 'draft', 'approved', 'posted', 'cancelled'] as Tab[]).map(key => ({ key, label: key === 'all' ? 'الكل' : STATUS_LABEL[key], count: counts?.[key] }))
  const newLink = canRequest && <Link href="/inventory/adjustments/new" className="btn">+ تسوية جديدة</Link>
  const columns: Column<Row>[] = [
    { header: 'الرقم', cell: r => <Link href={`/inventory/adjustments/${r.id}`} className="font-mono text-blue-700 hover:underline" dir="ltr">{r.adjustment_number}</Link> },
    { header: 'الفرع', cell: r => r.branch?.name_ar ?? '—' },
    { header: 'التاريخ', cell: r => <bdi dir="ltr">{formatDate(r.created_at)}</bdi> },
    { header: 'عدد الأصناف', align: 'end', cell: r => <Num value={r.line_count} /> },
    ...(showValue ? [{ header: 'الأثر على القيمة', align: 'end', cell: (r: Row) => r.net_value == null ? '—' : <Num value={r.net_value} kind="money" signed tone="auto" /> } as Column<Row>] : []),
    { header: 'الحالة', cell: r => badge(r.status) },
    { header: 'أنشأها', cell: creator },
  ]
  const isEmptyAll = !loading && !error && (counts?.all ?? 0) === 0 && !applied && !branchId

  return (
    <div className="space-y-4">
      <PageHeader title="تسويات المخزون" subtitle="تعديل رصيد أصناف مع ذكر السبب. تمر بمراحل: مسودة ثم اعتماد ثم ترحيل." actions={newLink} />
      <div className="card space-y-3">
        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <Field label="الفرع">
            <select className="select" value={branchId} onChange={e => { setBranchId(e.target.value); setPage(1) }}>
              <option value="">كل الفروع</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setApplied(query.trim()) }}>
            <input className="input" aria-label="ابحث برقم التسوية" placeholder="ابحث برقم التسوية، مثل ADJ-000123" value={query} onChange={e => setQuery(e.target.value)} />
            <button className="btn">بحث</button>
          </form>
        </div>
        <Tabs label="حالة التسوية" tabs={tabs} value={activeTab} onChange={k => { setTab(k); setPage(1) }} />
      </div>
      <div className="card p-2">
        <DataTable
          columns={columns} rows={data?.items ?? []} rowKey={r => r.id} loading={loading} caption="تسويات المخزون"
          error={error ? { message: error, onRetry: load } : undefined}
          empty={isEmptyAll
            ? { title: 'لا توجد تسويات بعد', hint: 'استخدم التسوية لتسجيل التالف أو المفقود أو تصحيح الكمية.', action: newLink || undefined }
            : { title: 'لا توجد تسويات في هذه الحالة.' }}
          mobileCard={r => (
            <Link href={`/inventory/adjustments/${r.id}`} className="block space-y-1">
              <div className="flex items-center justify-between"><bdi dir="ltr" className="font-mono font-medium">{r.adjustment_number}</bdi>{badge(r.status)}</div>
              <div className="text-sm text-gray-600">{r.branch?.name_ar} · <bdi dir="ltr">{formatDate(r.created_at)}</bdi> · {r.line_count} صنف</div>
              {showValue && r.net_value != null && <Num value={r.net_value} kind="money" signed tone="auto" />}
            </Link>
          )}
        />
        <Pager page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPage={setPage} disabled={loading} />
      </div>
    </div>
  )
}
