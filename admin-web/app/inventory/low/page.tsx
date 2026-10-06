'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import { formatDate } from '@/lib/format'
import { hasPermission } from '@/lib/permissions'
import { useBranches } from '@/lib/use-branches'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Field from '@/components/ui/Field'
import Num from '@/components/ui/Num'
import PageHeader from '@/components/ui/PageHeader'
import { Banner, NoPermission, Pager, Tabs } from '@/components/ui/PageStates'
import StatusBadge from '@/components/ui/StatusBadge'

type StatusTab = 'all' | 'zero' | 'negative' | 'no_stock_row'
interface LowRow {
  branch: { id: string; name_ar?: string } | null
  variant: { id: string; sku: string; label: string | null; name_ar: string | null; name_en: string | null; barcode?: string | null }
  qty_on_hand: number | null
  status: 'zero' | 'negative' | 'no_stock_row'
  last_sold_at: string | null
}
interface LowResponse { items: LowRow[]; page: number; total_pages: number; total: number; counts: Record<StatusTab, number> }

const BADGE = {
  zero: <StatusBadge tone="warn">نفد</StatusBadge>,
  negative: <StatusBadge tone="danger">بالسالب</StatusBadge>,
  no_stock_row: <StatusBadge tone="neutral">بلا رصيد مسجّل</StatusBadge>,
}
const nameOf = (row: LowRow) => row.variant.name_ar || row.variant.name_en || row.variant.sku

export default function LowStockPage() {
  const user = useSessionUser()
  const allowed = hasPermission(user, 'inventory.position.view')
  const canAdjust = hasPermission(user, 'inventory.adjustment.request')
  const canOpen = hasPermission(user, 'inventory.adjustment.post')
  const { branches, loading: branchesLoading } = useBranches(user)
  const [branchId, setBranchId] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<LowResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [explainerHidden, setExplainerHidden] = useState(false)
  const [emptyCatalog, setEmptyCatalog] = useState(false)

  useEffect(() => {
    if (!branchId && branches.length) setBranchId(user?.branch_id && branches.some(b => b.id === user.branch_id) ? user.branch_id : branches[0].id)
  }, [branches, branchId, user])

  const load = useCallback(async () => {
    if (!allowed || branchesLoading) return
    setLoading(true); setError('')
    const params = new URLSearchParams({ status: tab, page: String(page), page_size: '50' })
    if (branchId) params.set('branch_id', branchId)
    if (applied) params.set('q', applied)
    try { setData(await apiGet(`/inventory/low-stock?${params}`)) }
    catch (e: any) { setError(e.message || 'تعذر تحميل البيانات') }
    finally { setLoading(false) }
  }, [allowed, branchesLoading, branchId, tab, page, applied])
  useEffect(() => { void load() }, [load])

  // An empty list is good news only when the catalog has products; with none, point to adding them.
  const nothingListed = !!data && data.counts.all === 0 && !applied
  useEffect(() => {
    if (!nothingListed) { setEmptyCatalog(false); return }
    apiGet('/products?page=1&page_size=1').then(r => setEmptyCatalog(r?.total === 0)).catch(() => setEmptyCatalog(false))
  }, [nothingListed])

  if (!allowed) return <NoPermission />
  const branchName = branches.find(b => b.id === branchId)?.name ?? ''
  const counts = data?.counts
  const tabs: { key: StatusTab; label: string; count?: number | null }[] = [
    { key: 'all', label: 'الكل', count: counts?.all },
    { key: 'zero', label: 'نفد (صفر)', count: counts?.zero },
    { key: 'negative', label: 'بالسالب', count: counts?.negative },
    ...(branchId ? [{ key: 'no_stock_row' as StatusTab, label: 'بلا رصيد مسجّل', count: counts?.no_stock_row }] : []),
  ]

  const actionFor = (row: LowRow) => {
    if (row.status === 'negative' && canAdjust) {
      const need = Math.abs(Number(row.qty_on_hand ?? 0))
      return <Link className="btn-link" href={`/inventory/adjustments/new?sku=${encodeURIComponent(row.variant.sku)}&qty=${need}&branch_id=${branchId}`}>تسوية</Link>
    }
    if (row.status === 'no_stock_row' && canOpen) {
      return <Link className="btn-link" href={`/inventory/opening?sku=${encodeURIComponent(row.variant.sku)}&branch_id=${branchId}`}>رصيد افتتاحي</Link>
    }
    return null
  }

  const columns: Column<LowRow>[] = [
    { header: 'SKU', cell: r => <bdi dir="ltr" className="font-mono text-xs">{r.variant.sku}</bdi> },
    { header: 'الصنف', cell: r => <span className="font-medium text-gray-900">{nameOf(r)}{r.variant.label ? ` - ${r.variant.label}` : ''}</span> },
    { header: 'الكمية', align: 'end', cell: r => r.qty_on_hand === null ? <span className="text-gray-600">—</span> : <Num value={r.qty_on_hand} kind="qty" tone="auto" /> },
    { header: 'الحالة', cell: r => BADGE[r.status] },
    { header: 'آخر بيع', cell: r => <bdi dir="ltr">{formatDate(r.last_sold_at)}</bdi> },
    { header: 'إجراء', key: 'action', cell: r => actionFor(r) },
  ]

  const emptyTitle = branchName ? `لا توجد أصناف منتهية أو بالسالب في ${branchName}` : 'لا توجد أصناف منتهية أو بالسالب'
  const hasNegative = (counts?.negative ?? 0) > 0
  return (
    <div className="space-y-4">
      <PageHeader title="أصناف منتهية أو بالسالب" subtitle="أصناف رصيدها صفر أو أقل في الفرع المختار." />
      <div className="card space-y-3">
        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <Field label="الفرع">
            <select className="select" value={branchId} onChange={e => { setBranchId(e.target.value); setPage(1); if (!e.target.value && tab === 'no_stock_row') setTab('all') }}>
              {branches.length > 1 && !user?.branch_id && <option value="">كل الفروع</option>}
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setApplied(query.trim()) }}>
            <input className="input" aria-label="ابحث بالاسم أو SKU أو الباركود" placeholder="ابحث بالاسم أو SKU أو الباركود" value={query} onChange={e => setQuery(e.target.value)} />
            <button className="btn">بحث</button>
          </form>
        </div>
        <Tabs label="حالة الرصيد" tabs={tabs} value={tab} onChange={k => { setTab(k); setPage(1) }} />
      </div>
      {hasNegative && !explainerHidden && (
        <Banner tone="info" action={<button type="button" className="btn-link" onClick={() => setExplainerHidden(true)}>إخفاء</button>}>
          الرصيد بالسالب يعني أنك بعت صنفًا قبل تسجيل كميته. سجّل الرصيد الافتتاحي أو اعمل تسوية لتصحيحه.
        </Banner>
      )}
      <div className="card p-2">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={r => `${r.branch?.id ?? ''}-${r.variant.id}`}
          loading={loading}
          error={error ? { message: error, onRetry: load } : undefined}
          caption="أصناف منتهية أو بالسالب"
          empty={emptyCatalog
            ? { title: 'لا توجد منتجات بعد', hint: 'أضف منتجاتك أولًا، ثم تظهر هنا الأصناف المنتهية.', action: <Link className="btn" href="/products/import">استيراد من Excel</Link> }
            : { title: emptyTitle, hint: 'كل أصنافك لها رصيد.' }}
          mobileCard={r => (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-medium text-gray-900">{nameOf(r)}</div><bdi dir="ltr" className="font-mono text-xs text-gray-600">{r.variant.sku}</bdi></div>
                <div className="text-end"><div className="text-2xl font-bold">{r.qty_on_hand === null ? '—' : <Num value={r.qty_on_hand} kind="qty" tone="auto" />}</div>{BADGE[r.status]}</div>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-600"><span>آخر بيع: <bdi dir="ltr">{formatDate(r.last_sold_at)}</bdi></span>{actionFor(r)}</div>
            </div>
          )}
        />
        <Pager page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPage={setPage} disabled={loading} />
      </div>
    </div>
  )
}
