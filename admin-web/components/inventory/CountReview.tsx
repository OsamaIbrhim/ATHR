'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPost, ApiError } from '@/lib/api'
import { buildPostBody, postBlockReason, variantName, type ReviewFilter, type UncountedChoice } from '@/lib/counts'
import { toCsv } from '@/lib/import/csv'
import { formatMoney, formatQty } from '@/lib/format'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Num from '@/components/ui/Num'
import { Banner, Pager, Tabs } from '@/components/ui/PageStates'
import StatCard from '@/components/ui/StatCard'
import StickyActionBar from '@/components/ui/StickyActionBar'

interface Item {
  variant: { id: string; sku: string; label: string | null; name_ar: string | null; name_en: string | null }
  status: 'counted' | 'uncounted'; expected_at_count: number | null; counted: number | null; variance: number | null
  current_on_hand: number; movement_after_count: number | null; would_go_negative: boolean; unit_cost?: string; variance_value?: string | null
}

const FILTER_PARAM: Record<Exclude<ReviewFilter, 'unknown'>, string> = { variance: 'variance', all: 'all', increase: 'increase', decrease: 'decrease', uncounted: 'uncounted' }
const varianceWord = (v: number | null) => (v === null ? 'لم يُعدّ' : v === 0 ? 'مطابق' : v > 0 ? `زيادة ${formatQty(v)}` : `نقص ${formatQty(-v)}`)

export default function CountReview({ countId, branchName, count, showCost, canPost, canRecount, onChanged, onGoCount }: {
  countId: string; branchName: string; count: { status: string; active_counters: number; posted?: { name?: string | null; at?: string | null } | null }
  showCost: boolean; canPost: boolean; canRecount: boolean; onChanged: () => void; onGoCount: () => void
}) {
  const open = count.status === 'open'
  const [filter, setFilter] = useState<ReviewFilter>('variance')
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [choice, setChoice] = useState<UncountedChoice | null>(null)
  const [overrides, setOverrides] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const p = new URLSearchParams({ page: String(page), page_size: '50', filter: filter === 'unknown' ? 'all' : FILTER_PARAM[filter] })
    if (applied) p.set('q', applied)
    try { setData(await apiGet(`/inventory/counts/${countId}/review?${p}`)) }
    catch (e: any) { setError(e.message || 'تعذر تحميل المراجعة') }
    finally { setLoading(false) }
  }, [countId, page, filter, applied])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const v = () => { if (document.visibilityState === 'visible') void load() }; document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v) }, [load])

  const s = data?.summary
  const uncounted = s?.uncounted_items ?? 0
  const blocked = postBlockReason({ canPost, countedItems: s?.counted_items ?? 0, uncountedItems: uncounted, choice })
  const toggle = (id: string) => setOverrides(cur => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const zeroed = (id: string) => (choice === 'zero') !== overrides.has(id)

  const post = async () => {
    setBusy(true); setBanner('')
    try { await apiPost(`/inventory/counts/${countId}/post`, buildPostBody(uncounted > 0 ? choice : null, overrides)); toast.success('تم ترحيل الجرد'); setConfirming(false); onChanged() }
    catch (e: any) {
      setConfirming(false)
      setBanner(e instanceof ApiError && e.code === 'STOCK_COUNT_WOULD_GO_NEGATIVE' ? `تعذر الترحيل: ${e.message}` : e.message || 'تعذر الترحيل.')
    } finally { setBusy(false) }
  }
  const recount = async (id: string) => { try { await apiDelete(`/inventory/counts/${countId}/lines/${id}`); toast.success('أُعيد الصنف إلى العدّ'); void load() } catch (e: any) { setBanner(e.message) } }
  const exportCsv = async () => {
    const out: (string | number)[][] = [['SKU', 'الصنف', 'المتوقع', 'المعدود', 'الفرق', ...(showCost ? ['الأثر على القيمة'] : [])]]
    for (let p = 1; p <= 50; p++) {
      const r = await apiGet(`/inventory/counts/${countId}/review?filter=variance&page=${p}&page_size=100`)
      for (const i of r.items as Item[]) out.push([i.variant.sku, variantName(i.variant), i.expected_at_count ?? '', i.counted ?? '', i.variance ?? '', ...(showCost ? [i.variance_value ?? ''] : [])])
      if (p >= r.total_pages) break
    }
    const url = URL.createObjectURL(new Blob([toCsv(out)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'count-variances.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const columns: Column<Item>[] = [
    { header: 'الصنف', cell: i => <div><div className="font-medium">{variantName(i.variant)}</div><bdi dir="ltr" className="font-mono text-xs text-gray-600">{i.variant.sku}</bdi></div> },
    { header: 'المتوقع', align: 'end', cell: i => i.expected_at_count === null ? '—' : <Num value={i.expected_at_count} kind="qty" /> },
    { header: 'المعدود', align: 'end', cell: i => i.counted === null ? <span className="text-gray-600">لم يُعدّ</span> : <Num value={i.counted} kind="qty" /> },
    { header: 'حركة بعد العدّ', align: 'end', cell: i => i.movement_after_count ? <Num value={i.movement_after_count} kind="qty" signed /> : '—' },
    { header: 'الفرق', cell: i => <span className={i.variance === null ? '' : i.variance > 0 ? 'badge-ok' : i.variance < 0 ? 'badge-danger' : 'badge-neutral'}>{varianceWord(i.variance)}{i.would_go_negative && ' · بالسالب'}</span> },
    ...(showCost ? [{ header: 'الأثر على القيمة', align: 'end', cell: (i: Item) => i.variance_value == null ? '—' : <Num value={i.variance_value} kind="money" signed tone="auto" /> } as Column<Item>] : []),
    { header: '', key: 'act', cell: i => i.status === 'uncounted'
      ? (choice && open && canPost ? <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={zeroed(i.variant.id)} onChange={() => toggle(i.variant.id)} />اعتباره صفر</label> : null)
      : (open && canRecount && i.variance ? <button type="button" className="btn-link" onClick={() => recount(i.variant.id)}>إعادة العدّ</button> : null) },
  ]
  const tabs = [
    { key: 'variance' as const, label: 'بها فرق', count: s?.items_with_variance }, { key: 'all' as const, label: 'الكل' },
    { key: 'increase' as const, label: 'زيادة' }, { key: 'decrease' as const, label: 'نقص' },
    { key: 'uncounted' as const, label: 'لم يُعدّ', count: s?.uncounted_items }, { key: 'unknown' as const, label: 'غير معروف', count: data?.unknown_barcodes?.length },
  ]
  const net = s?.net_value
  return (
    <div className="space-y-4">
      {banner && <Banner tone="danger">{banner}</Banner>}
      {open && count.active_counters > 0 && <Banner tone="info">{count.active_counters} عدّاد نشط الآن — قد تتغير الأرقام.</Banner>}
      {count.status === 'posted' && <Banner tone="ok">تم الترحيل بواسطة {count.posted?.name ?? '—'}.</Banner>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="أصناف معدودة" value={s?.counted_items} loading={loading && !s} />
        <StatCard label="أصناف بها فرق" value={s?.items_with_variance} loading={loading && !s} />
        <StatCard label="زيادة" tone="ok" loading={loading && !s} value={showCost ? formatMoney(s?.increase_value, { signed: true }) : `+${formatQty(s?.increase_qty ?? 0)} وحدة`} />
        <StatCard label="نقص" tone="danger" loading={loading && !s} value={showCost ? formatMoney(s?.decrease_value) : `−${formatQty(s?.decrease_qty ?? 0)} وحدة`} />
        {showCost && <StatCard large label="صافي أثر الجرد" value={formatMoney(net, { signed: true })} tone={Number(net) < 0 ? 'danger' : 'ok'} loading={loading && !s} />}
      </div>
      {open && uncounted > 0 && (
        <fieldset className="card border-amber-300 bg-amber-50">
          <legend className="sr-only">الأصناف التي لم تُعدّ</legend>
          <div className="font-bold text-amber-900">{uncounted} صنف لم يُعدّ</div>
          <p className="mb-2 text-sm">اختر ما يحدث لرصيد هذه الأصناف عند الترحيل:</p>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="uncounted" checked={choice === 'zero'} onChange={() => { setChoice('zero'); setOverrides(new Set()) }} />اعتبرها صفر — يُصفَّر رصيدها في النظام{showCost && s?.uncounted_value ? ` (نقص ${formatMoney(s.uncounted_value)})` : ''}</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="uncounted" checked={choice === 'ignore'} onChange={() => { setChoice('ignore'); setOverrides(new Set()) }} />اتركها كما هي — لا يتغيّر رصيدها</label>
        </fieldset>
      )}
      <div className="card space-y-3">
        <Tabs label="تصفية المراجعة" tabs={tabs} value={filter} onChange={k => { setFilter(k); setPage(1) }} />
        <div className="flex gap-2">
          <form className="flex flex-1 gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setApplied(query.trim()) }}>
            <input className="input" aria-label="بحث في المراجعة" placeholder="SKU أو الاسم أو الباركود" value={query} onChange={e => setQuery(e.target.value)} /><button className="btn">بحث</button>
          </form>
          <button type="button" className="btn-secondary" onClick={exportCsv}>تنزيل تقرير الفروق</button>
        </div>
        {filter === 'unknown' ? (
          data?.unknown_barcodes?.length ? (
            <table><thead><tr><th>الباركود</th><th className="text-end">مرات المسح</th><th /></tr></thead><tbody>
              {data.unknown_barcodes.map((u: any) => <tr key={u.barcode}><td><bdi dir="ltr" className="font-mono">{u.barcode}</bdi></td><td className="text-end"><Num value={u.scans} /></td><td><Link className="btn-link" href="/products/new" target="_blank">إضافة منتج</Link></td></tr>)}
            </tbody></table>
          ) : <p className="py-6 text-center text-sm text-gray-600">لا توجد باركودات غير معروفة.</p>
        ) : (
          <>
            <DataTable
              columns={columns} rows={data?.items ?? []} rowKey={i => i.variant.id} loading={loading} caption="فروق الجرد"
              error={error ? { message: error, onRetry: load } : undefined}
              empty={(s?.counted_items ?? 0) === 0 && filter !== 'uncounted' ? { title: 'لم يُعدّ أي صنف بعد', hint: 'عُد للعدّ ثم ارجع للمراجعة.', action: <button type="button" className="btn-secondary" onClick={onGoCount}>الذهاب للعدّ</button> } : { title: 'لا توجد أصناف في هذه التصفية.' }}
              mobileCard={i => (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2"><div><div className="font-medium">{variantName(i.variant)}</div><bdi dir="ltr" className="font-mono text-xs text-gray-600">{i.variant.sku}</bdi></div><span className={i.variance === null ? 'badge-neutral' : i.variance > 0 ? 'badge-ok' : i.variance < 0 ? 'badge-danger' : 'badge-neutral'}>{varianceWord(i.variance)}</span></div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs text-gray-600"><div>المتوقع<div className="text-base font-bold text-gray-900">{i.expected_at_count ?? '—'}</div></div><div>المعدود<div className="text-base font-bold text-gray-900">{i.counted ?? '—'}</div></div><div>الفرق<div className="text-base font-bold text-gray-900">{i.variance ?? '—'}</div></div></div>
                </div>
              )}
            />
            <Pager page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPage={setPage} disabled={loading} />
          </>
        )}
      </div>
      {open && (
        <StickyActionBar>
          {canPost ? (
            <div className="flex flex-col gap-1"><button type="button" className="btn btn-lg" disabled={!!blocked || busy} onClick={() => setConfirming(true)}>ترحيل الجرد</button>{blocked && <span className="text-xs text-gray-600">{blocked}</span>}</div>
          ) : <span className="text-sm text-gray-600">الترحيل يقوم به مسؤول المخزون.</span>}
          <span className="text-sm">{s?.items_with_variance ?? 0} صنف سيتغيّر رصيده{showCost && net != null ? <> · صافي <bdi dir="ltr">{formatMoney(net, { signed: true })}</bdi></> : null}</span>
        </StickyActionBar>
      )}
      <ConfirmDialog open={confirming} title="ترحيل الجرد؟" confirmLabel="ترحيل الجرد" tone={choice === 'zero' ? 'danger' : 'primary'} loading={busy}
        requireCheck={choice === 'zero' && uncounted > 0 ? `أؤكد تصفير رصيد ${uncounted - overrides.size} صنف` : undefined} onConfirm={post} onClose={() => setConfirming(false)}>
        <p>سيتم تعديل رصيد {s?.items_with_variance ?? 0} صنف في {branchName}.</p>
        {showCost && <p>زيادة {formatMoney(s?.increase_value, { signed: true })} · نقص {formatMoney(s?.decrease_value)} · صافي {formatMoney(net, { signed: true })}</p>}
        {uncounted > 0 && choice === 'zero' && <p>{uncounted - overrides.size} صنف لم يُعدّ وسيُصفَّر رصيده.</p>}
        {uncounted > 0 && choice === 'ignore' && <p>{uncounted - overrides.size} صنف لم يُعدّ وسيبقى رصيده كما هو.</p>}
        <p>لا يمكن التراجع؛ التصحيح يكون بتسوية جديدة.</p>
      </ConfirmDialog>
    </div>
  )
}
