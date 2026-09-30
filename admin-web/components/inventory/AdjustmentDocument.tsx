'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPost, apiPut, ApiError } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import {
  adjustmentTotals, buildAdjustmentBody, documentActions, lineErrorFrom, MAX_ADJUSTMENT_LINES, progressStep, STATUS_LABEL, STATUS_TONE,
  validateAdjustmentLine, type AdjustmentLine, type AdjustmentStatus,
} from '@/lib/adjustments'
import { formatDate, formatMoney } from '@/lib/format'
import { loadUoms, quantityPrecision, searchItems, type PickedItem, type UomInfo } from '@/lib/items'
import { hasPermission } from '@/lib/permissions'
import { useBranches } from '@/lib/use-branches'
import AdjustmentLines from './AdjustmentLines'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Field from '@/components/ui/Field'
import ItemPicker, { type ItemPickerHandle } from '@/components/ui/ItemPicker'
import Num from '@/components/ui/Num'
import PageHeader from '@/components/ui/PageHeader'
import { Banner, LoadFailed, NoPermission } from '@/components/ui/PageStates'
import StatusBadge from '@/components/ui/StatusBadge'
import Stepper from '@/components/ui/Stepper'
import StickyActionBar from '@/components/ui/StickyActionBar'

type Dialog = null | 'approve' | 'post' | 'cancel'
interface Who { name?: string | null; at?: string | null }

const signedMoney = (n: number) => formatMoney(n, { signed: true, unit: false })

export default function AdjustmentDocument({ id }: { id: string | null }) {
  const user = useSessionUser()
  const router = useRouter()
  const params = useSearchParams()
  const can = {
    request: hasPermission(user, 'inventory.adjustment.request'),
    approve: hasPermission(user, 'inventory.adjustment.approve'),
    post: hasPermission(user, 'inventory.adjustment.post'),
  }
  const showValue = hasPermission(user, 'inventory.position.view-cost')
  const allowed = hasPermission(user, 'inventory.movement.view') && (id !== null || can.request)
  const { branches } = useBranches(user)
  const [doc, setDoc] = useState<any>(null)
  const [loading, setLoading] = useState(id !== null)
  const [loadError, setLoadError] = useState('')
  const [lines, setLines] = useState<AdjustmentLine[]>([])
  const [note, setNote] = useState('')
  const [branchId, setBranchId] = useState(params.get('branch_id') ?? '')
  const [uoms, setUoms] = useState<Map<string, UomInfo>>(new Map())
  const [dirty, setDirty] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({})
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warn'; text: string; conflict?: boolean } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const picker = useRef<ItemPickerHandle>(null)
  const qtyRefs = useRef(new Map<string, HTMLInputElement>())
  const commandId = useRef(`adj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

  useEffect(() => { void loadUoms().then(setUoms) }, [])
  useEffect(() => {
    if (id === null && !branchId && branches.length) setBranchId(user?.branch_id && branches.some(b => b.id === user.branch_id) ? user.branch_id : branches[0].id)
  }, [id, branches, branchId, user])

  const fromDoc = useCallback((d: any): AdjustmentLine[] => (d.items ?? []).map((it: any) => ({
    item: { id: it.variant.id, sku: it.variant.sku ?? '', label: it.variant.label || null, name: it.variant.name_ar || it.variant.name_en || it.variant.sku, barcodes: [], costPrice: null, baseUomId: null, tracked: false, stocked: true, available: it.qty_on_hand },
    qty: String(it.qty_delta), reason: it.reason_code, note: it.note ?? '', precision: 3,
    onHand: d.status === 'posted' ? it.qty_before : it.qty_on_hand,
    unitCost: it.unit_cost !== undefined ? Number(it.unit_cost) : null, locked: d.status !== 'draft',
  })), [])
  const load = useCallback(async () => {
    if (id === null) return
    setLoading(true); setLoadError('')
    try { const d = await apiGet(`/inventory/adjustments/${id}`); setDoc(d); setLines(fromDoc(d)); setNote(d.note ?? ''); setDirty(false); setBanner(null) }
    catch (e: any) { setLoadError(e.message || 'تعذر تحميل التسوية') }
    finally { setLoading(false) }
  }, [id, fromDoc])
  useEffect(() => { void load() }, [load])

  const status: AdjustmentStatus | 'new' = doc?.status ?? 'new'
  const actions = status === 'new' ? { edit: can.request, approve: false, post: false, cancel: false, waitingApproval: false, waitingPost: false } : documentActions(status, can)
  const editable = actions.edit
  const focusQty = (variantId: string) => requestAnimationFrame(() => { const el = qtyRefs.current.get(variantId); el?.focus(); el?.select() })

  const addItem = useCallback((item: PickedItem, opts: { fromScan: boolean; packQty: number }, presetQty?: string) => {
    setLines(cur => {
      const at = cur.findIndex(l => l.item.id === item.id)
      if (at >= 0) {
        if (opts.fromScan) { const next = [...cur]; next[at] = { ...next[at], qty: String((Number(next[at].qty) || 0) + opts.packQty) }; return next }
        setBanner({ tone: 'warn', text: 'هذا الصنف مضاف في سطر آخر' }); focusQty(item.id); return cur
      }
      if (cur.length >= MAX_ADJUSTMENT_LINES) { toast.error(`الحد الأقصى ${MAX_ADJUSTMENT_LINES} سطر.`); return cur }
      const unitCost = showValue && item.costPrice !== null ? Number(item.costPrice) : null
      return [...cur, { item, qty: presetQty ?? (opts.fromScan ? String(opts.packQty) : ''), reason: presetQty ? 'correction' : '', note: '', precision: uoms.size ? quantityPrecision(item, uoms) : 3, onHand: item.available, unitCost }]
    })
    setDirty(true); setBanner(null); focusQty(item.id)
  }, [uoms, showValue])

  const skuParam = params.get('sku')
  useEffect(() => {
    if (id !== null || !skuParam || !branchId || !uoms.size) return
    void searchItems(skuParam, branchId).then(found => { const hit = found.find(i => i.sku === skuParam); if (hit) addItem(hit, { fromScan: false, packQty: 1 }, params.get('qty') ?? undefined) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuParam, branchId, uoms.size])

  const totals = useMemo(() => adjustmentTotals(lines), [lines])
  const invalid = lines.some(l => Object.keys(validateAdjustmentLine(l)).length > 0)
  const change = (i: number, patch: Partial<AdjustmentLine>) => { setLines(cur => cur.map((l, at) => at === i ? { ...l, ...patch } : l)); setDirty(true); setLineErrors({}) }

  const fail = (e: any) => {
    const conflict = e instanceof ApiError && ['ADJUSTMENT_NOT_DRAFT', 'ADJUSTMENT_NOT_APPROVED', 'ADJUSTMENT_ALREADY_POSTED'].includes(e.code)
    const at = e instanceof ApiError ? lineErrorFrom(e) : null
    if (at) setLineErrors({ [at.index]: e.message })
    setBanner(conflict ? { tone: 'warn', text: 'تغيّر هذا المستند أثناء عملك.', conflict: true } : { tone: 'danger', text: e.message || 'تعذر تنفيذ العملية.' })
  }
  const saveDraft = async (): Promise<string | null> => {
    setShowErrors(true)
    if (!lines.length || invalid) { setBanner({ tone: 'danger', text: 'أكمل بيانات كل الأسطر أولًا.' }); return null }
    setBusy(true); setBanner(null)
    try {
      const body = buildAdjustmentBody(lines, note)
      if (id === null) {
        const created = await apiPost('/inventory/adjustments', { branch_id: branchId, command_id: commandId.current, ...body })
        toast.success('تم حفظ المسودة'); router.replace(`/inventory/adjustments/${created.id}`); return created.id
      }
      await apiPut(`/inventory/adjustments/${id}`, body); toast.success('تم حفظ المسودة'); await load(); return id
    } catch (e: any) { fail(e); return null } finally { setBusy(false) }
  }
  const step = async (kind: 'approve' | 'post' | 'cancel') => {
    setBusy(true)
    try {
      await apiPost(`/inventory/adjustments/${id}/${kind}`, kind === 'cancel' ? {} : undefined)
      toast.success({ approve: 'تم اعتماد التسوية', post: 'تم ترحيل التسوية', cancel: 'تم إلغاء التسوية' }[kind]); setDialog(null); await load()
    } catch (e: any) { setDialog(null); fail(e) } finally { setBusy(false) }
  }

  if (!allowed) return <NoPermission />
  if (loadError) return <LoadFailed message={loadError} onRetry={load} />
  if (loading) return <div className="space-y-3" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl bg-gray-100" />)}</div>
  const who = (w: Who | null | undefined) => (w?.at ? `${w.name ?? ''} · ${formatDate(w.at)}` : undefined)
  const steps = [
    { key: 'request', label: 'الطلب', meta: who(doc?.created) ?? 'بانتظار' },
    { key: 'approve', label: 'الاعتماد', meta: who(doc?.approved) ?? 'بانتظار' },
    { key: 'post', label: 'الترحيل', meta: who(doc?.posted) ?? 'بانتظار' },
  ]
  const branchName = doc?.branch?.name_ar ?? branches.find(b => b.id === branchId)?.name ?? ''
  const net = totals.valueKnown ? signedMoney(totals.net) : null
  return (
    <div className="space-y-4">
      <PageHeader
        title={doc ? `تسوية ${doc.adjustment_number}` : 'تسوية جديدة'} back={{ href: '/inventory/adjustments', label: 'تسويات المخزون' }}
        badge={doc && <StatusBadge tone={STATUS_TONE[status as AdjustmentStatus]}>{STATUS_LABEL[status as AdjustmentStatus]}</StatusBadge>}
      />
      {banner && <Banner tone={banner.tone} action={banner.conflict ? <button className="btn-secondary btn-sm" onClick={() => location.reload()}>تحديث الصفحة</button> : undefined}>{banner.text}</Banner>}
      {doc && <Stepper steps={steps} current={Math.min(progressStep(status as AdjustmentStatus), 2)} ariaLabel="مراحل التسوية" />}
      {status === 'cancelled' && <Banner tone="warn">أُلغيت هذه التسوية{doc.cancellation_reason ? `: ${doc.cancellation_reason}` : '.'}</Banner>}
      {doc?.status === 'posted' && <Link href="/inventory" className="btn-link">عرض حركات المخزون</Link>}
      <div className="card grid gap-3 md:grid-cols-[14rem_1fr]">
        <Field label="الفرع" required>
          {id === null
            ? <select className="select" value={branchId} disabled={lines.length > 0} onChange={e => setBranchId(e.target.value)}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            : <div className="min-h-11 py-2 font-medium">{branchName}</div>}
        </Field>
        <Field label="ملاحظة عامة (اختياري)">
          {editable ? <textarea className="input" rows={2} maxLength={300} value={note} onChange={e => { setNote(e.target.value); setDirty(true) }} /> : <div className="py-2 text-sm">{note || '—'}</div>}
        </Field>
        {editable && (
          <div className="md:col-span-2">
            <ItemPicker ref={picker} branchId={branchId} autoFocus={id === null} placeholder="أضف صنفًا: امسح أو ابحث" onPick={(item, o) => addItem(item, o)} />
          </div>
        )}
      </div>
      <div className="card p-2 md:p-3">
        {lines.length ? (
          <AdjustmentLines
            lines={lines} editable={editable} showValue={showValue} showErrors={showErrors} lineErrors={lineErrors}
            setRef={(v, el) => { if (el) qtyRefs.current.set(v, el); else qtyRefs.current.delete(v) }}
            onChange={change} onRemove={i => { setLines(cur => cur.filter((_, at) => at !== i)); setDirty(true) }} onQtyEnter={() => picker.current?.focus()}
          />
        ) : <p className="py-8 text-center text-sm text-gray-600">لم تُضف أصناف بعد. امسح باركود أو ابحث بالاسم.</p>}
        {showValue && totals.valueKnown && (
          <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-gray-100 pt-3 text-sm">
            <span>زيادات <Num value={totals.increase} kind="money" signed /></span>
            <span>نقص <Num value={-totals.decrease} kind="money" signed /></span>
            <span className="font-bold">الصافي <Num value={totals.net} kind="money" signed tone="auto" /></span>
          </div>
        )}
      </div>
      <StickyActionBar>
        <div className="flex flex-wrap items-center gap-2">
          {actions.approve && <button className="btn btn-lg" disabled={busy || dirty} onClick={() => setDialog('approve')}>اعتماد</button>}
          {actions.post && <button className="btn btn-lg" disabled={busy} onClick={() => setDialog('post')}>ترحيل</button>}
          {actions.edit && <button className={actions.approve ? 'btn-secondary btn-lg' : 'btn btn-lg'} disabled={busy || !dirty && id !== null} onClick={saveDraft}>{busy ? 'جارٍ…' : 'حفظ المسودة'}</button>}
          {actions.cancel && <button className="btn-secondary btn-lg" disabled={busy} onClick={() => setDialog('cancel')}>إلغاء التسوية</button>}
          {actions.approve && dirty && <span className="text-xs text-gray-600">احفظ المسودة قبل الاعتماد.</span>}
          {actions.waitingApproval && <span className="text-sm text-gray-600">بانتظار الاعتماد من مسؤول المحل.</span>}
          {actions.waitingPost && <span className="text-sm text-gray-600">بانتظار الترحيل من مسؤول المخزون.</span>}
        </div>
        <div className="text-sm text-gray-700">{lines.length} صنف{net ? <> · الصافي <bdi dir="ltr">{net}</bdi> ج.م</> : null}</div>
      </StickyActionBar>
      <ConfirmDialog open={dialog === 'approve'} title="اعتماد التسوية؟" confirmLabel="اعتماد" loading={busy} onConfirm={() => step('approve')} onClose={() => setDialog(null)}>
        <p>ستصبح التسوية جاهزة للترحيل ولن يمكن تعديل أسطرها.</p>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'post'} title="ترحيل التسوية؟" confirmLabel="ترحيل" loading={busy} onConfirm={() => step('post')} onClose={() => setDialog(null)}>
        <p>سيتغيّر رصيد {lines.length} صنف في {branchName}{net ? ` بصافي ${net} ج.م` : ''}. لا يمكن التراجع؛ التصحيح يكون بتسوية جديدة.</p>
        {totals.negatives > 0 && <p className="alert-warn">{totals.negatives} صنف سيصبح رصيده بالسالب.</p>}
      </ConfirmDialog>
      <ConfirmDialog open={dialog === 'cancel'} title="إلغاء التسوية؟" confirmLabel="إلغاء التسوية" tone="danger" loading={busy} onConfirm={() => step('cancel')} onClose={() => setDialog(null)}>
        <p>لن يتغيّر أي رصيد.</p>
      </ConfirmDialog>
    </div>
  )
}
