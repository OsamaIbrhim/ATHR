'use client'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPost } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import { COUNT_STATUS_LABEL, COUNT_STATUS_TONE, scopeLabel, type CountStatus } from '@/lib/counts'
import { formatDate, formatQty } from '@/lib/format'
import { hasPermission } from '@/lib/permissions'
import CounterView from '@/components/inventory/CounterView'
import CountReview from '@/components/inventory/CountReview'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import PageHeader from '@/components/ui/PageHeader'
import { Banner, LoadFailed, NoPermission, Tabs } from '@/components/ui/PageStates'
import StatusBadge from '@/components/ui/StatusBadge'

export default function CountPage() {
  const { id } = useParams<{ id: string }>()
  const user = useSessionUser()
  const canCount = hasPermission(user, 'inventory.adjustment.request')
  const canApprove = hasPermission(user, 'inventory.adjustment.approve')
  const canPost = hasPermission(user, 'inventory.adjustment.post')
  const canReview = canCount && canApprove
  const showCost = hasPermission(user, 'inventory.position.view-cost')
  const [count, setCount] = useState<any>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'count' | 'review' | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try { setCount(await apiGet(`/inventory/counts/${id}`)) } catch (e: any) { setError(e.message || 'تعذر تحميل الجرد') }
  }, [id])
  useEffect(() => { if (canCount) void load() }, [canCount, load])

  if (!canCount) return <NoPermission />
  if (error) return <LoadFailed message={error} onRetry={load} />
  if (!count) return <div className="space-y-3" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="h-20 animate-pulse rounded-2xl bg-gray-100" />)}</div>
  const status = count.status as CountStatus
  const active: 'count' | 'review' = tab ?? (status === 'open' ? 'count' : 'review')
  const cancel = async () => {
    setBusy(true)
    try { await apiPost(`/inventory/counts/${id}/cancel`, {}); toast.success('أُلغي الجرد'); setCancelling(false); await load() }
    catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-4">
      <PageHeader
        title={count.name} back={{ href: '/inventory/counts', label: 'الجرد' }}
        subtitle={`${count.branch?.name_ar ?? ''} · ${scopeLabel(count.scope)} · ${formatDate(count.started?.at)}`}
        badge={<StatusBadge tone={COUNT_STATUS_TONE[status]}>{COUNT_STATUS_LABEL[status]}</StatusBadge>}
        actions={<>
          <span className="badge-neutral">عُدّ {count.counted_items} صنف · {formatQty(count.counted_units)} وحدة</span>
          {status === 'open' && canReview && <button type="button" className="btn-secondary btn-sm" onClick={() => setCancelling(true)}>إلغاء الجرد</button>}
        </>}
      />
      {status === 'cancelled' && <Banner tone="warn">أُلغي هذا الجرد ولم يتغيّر أي رصيد.</Banner>}
      {canReview && <Tabs<'count' | 'review'> label="أقسام الجرد" value={active} onChange={setTab} tabs={[{ key: 'count', label: 'العدّ' }, { key: 'review', label: 'المراجعة' }]} />}
      {active === 'count' || !canReview
        ? <CounterView countId={id} count={count} canReview={canReview} canAddOutOfScope={canApprove} onReview={() => setTab('review')} />
        : <CountReview countId={id} branchName={count.branch?.name_ar ?? ''} count={count} showCost={showCost} canPost={canPost} canRecount={canApprove} onChanged={load} onGoCount={() => setTab('count')} />}
      <ConfirmDialog open={cancelling} title="إلغاء الجرد؟" confirmLabel="إلغاء الجرد" tone="danger" loading={busy} onConfirm={cancel} onClose={() => setCancelling(false)}>
        <p>سيتم حذف كل ما عُدّ ولن يتغيّر أي رصيد.</p>
      </ConfirmDialog>
    </div>
  )
}
