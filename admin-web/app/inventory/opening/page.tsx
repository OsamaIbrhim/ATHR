'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPost, ApiError } from '@/lib/api'
import { useSessionUser } from '@/components/AuthGate'
import { formatMoney } from '@/lib/format'
import { loadUoms, quantityPrecision, searchItems, toPickedItem, type PickedItem, type UomInfo } from '@/lib/items'
import {
  applyOpeningResults, buildOpeningBody, loadDraft, MAX_OPENING_LINES, payloadSignature, saveDraft, totals, validateOpeningLine, type OpeningLine,
} from '@/lib/opening'
import { hasPermission } from '@/lib/permissions'
import { useBranches } from '@/lib/use-branches'
import OpeningLines from '@/components/inventory/OpeningLines'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import EmptyState from '@/components/ui/EmptyState'
import Field from '@/components/ui/Field'
import ItemPicker, { type ItemPickerHandle } from '@/components/ui/ItemPicker'
import PageHeader from '@/components/ui/PageHeader'
import { Banner, NoPermission } from '@/components/ui/PageStates'
import StickyActionBar from '@/components/ui/StickyActionBar'

const newKey = () => `ob-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36)}`

function OpeningBalance() {
  const user = useSessionUser()
  const params = useSearchParams()
  const allowed = hasPermission(user, 'inventory.adjustment.post') && hasPermission(user, 'inventory.position.view-cost')
  const { branches, loading: branchesLoading } = useBranches(user)
  const [branchId, setBranchId] = useState(params.get('branch_id') ?? '')
  const [lines, setLines] = useState<OpeningLine[]>([])
  const [uoms, setUoms] = useState<Map<string, UomInfo>>(new Map())
  const [unknown, setUnknown] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warn' | 'ok'; text: string } | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const [draftOffer, setDraftOffer] = useState(0)
  const [pending, setPending] = useState<number | null>(null)
  const picker = useRef<ItemPickerHandle>(null)
  const refs = useRef(new Map<string, HTMLInputElement>())
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const skuParam = params.get('sku')

  useEffect(() => { void loadUoms().then(setUoms) }, [])
  useEffect(() => {
    if (!branchId && branches.length) setBranchId(user?.branch_id && branches.some(b => b.id === user.branch_id) ? user.branch_id : branches[0].id)
  }, [branches, branchId, user])
  useEffect(() => { saveDraft(typeof window === 'undefined' ? null : localStorage, branchId, lines) }, [lines, branchId])
  useEffect(() => {
    if (!branchId) return
    setDraftOffer(lines.length ? 0 : loadDraft(localStorage, branchId).length)
    apiGet(`/inventory/low-stock?status=no_stock_row&branch_id=${branchId}&page_size=1`)
      .then(r => setPending(typeof r?.counts?.no_stock_row === 'number' ? r.counts.no_stock_row : null)).catch(() => setPending(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId])

  const setRef = useCallback((id: string, field: 'qty' | 'cost', el: HTMLInputElement | null) => {
    if (el) refs.current.set(`${id}:${field}`, el); else refs.current.delete(`${id}:${field}`)
  }, [])
  const focus = (id: string, field: 'qty' | 'cost') => requestAnimationFrame(() => { const el = refs.current.get(`${id}:${field}`); el?.focus(); el?.select() })

  const toLine = useCallback((item: PickedItem, packQty: number, qty: string): OpeningLine => {
    const cost = item.costPrice !== null && Number(item.costPrice) > 0 ? String(Number(item.costPrice)) : ''
    return { item, qty, cost, costFromItem: !!cost, precision: uoms.size ? quantityPrecision(item, uoms) : 3, packQty }
  }, [uoms])

  const addItem = useCallback((item: PickedItem, opts: { fromScan: boolean; packQty: number }) => {
    setUnknown(null); setDone(null)
    setLines(current => {
      const at = current.findIndex(l => l.item.id === item.id)
      if (at >= 0) {
        const next = [...current]
        const qty = String((Number(next[at].qty) || 0) + opts.packQty)
        next[at] = { ...next[at], qty, packQty: opts.packQty }
        return next
      }
      if (current.length >= MAX_OPENING_LINES) { toast.error(`الحد الأقصى ${MAX_OPENING_LINES} سطر في كل تسجيل.`); return current }
      return [toLine(item, opts.packQty, opts.fromScan ? String(opts.packQty) : ''), ...current]
    })
    if (opts.fromScan && lines.some(l => l.item.id === item.id)) {
      setFlashId(item.id); setTimeout(() => setFlashId(null), 600); picker.current?.focus()
    } else focus(item.id, 'qty')
  }, [toLine, lines])

  useEffect(() => {
    if (!skuParam || !branchId || !uoms.size) return
    void searchItems(skuParam, branchId).then(found => { const hit = found.find(i => i.sku === skuParam); if (hit) addItem(hit, { fromScan: false, packQty: 1 }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuParam, branchId, uoms.size])

  const addAllPending = async () => {
    try {
      const pages = await Promise.all([1, 2].map(p => apiGet(`/inventory/low-stock?status=no_stock_row&branch_id=${branchId}&page=${p}&page_size=100`)))
      const have = new Set(lines.map(l => l.item.id))
      const added: OpeningLine[] = []
      for (const row of pages.flatMap(p => p.items ?? [])) {
        if (have.has(row.variant.id) || row.variant.tracking !== 'none' || lines.length + added.length >= MAX_OPENING_LINES) continue
        const item = toPickedItem({ ...row.variant, product: { name_ar: row.variant.name_ar, name_en: row.variant.name_en }, barcodes: row.variant.barcode ? [{ code: row.variant.barcode, pack_qty: 1 }] : [] })
        added.push({ ...toLine(item, 1, ''), precision: 3 })
      }
      setLines(current => [...added, ...current])
      if (!added.length) toast('لا توجد أصناف جديدة لإضافتها')
    } catch (e: any) { setBanner({ tone: 'danger', text: e.message || 'تعذر تحميل الأصناف.' }) }
  }

  const change = (id: string, patch: Partial<OpeningLine>) => setLines(cur => cur.map(l => l.item.id === id ? { ...l, ...patch } : l))
  const onEnter = (id: string, field: 'qty' | 'cost') => { if (field === 'qty') focus(id, 'cost'); else picker.current?.focus() }
  const invalid = useMemo(() => lines.some(l => Object.keys(validateOpeningLine(l, { needCost: true })).some(k => k !== 'warn')), [lines])
  const sum = totals(lines)
  const branchName = branches.find(b => b.id === branchId)?.name ?? ''
  const reason = !lines.length ? 'أضف صنفًا واحدًا على الأقل.' : invalid ? 'أكمل الكمية والتكلفة في كل الأسطر.' : ''

  const submit = async () => {
    setSubmitting(true); setBanner(null)
    const preview = buildOpeningBody(branchId, '', lines, true)
    const signature = payloadSignature(preview)
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newKey() }
    let results: any[] | null = null
    try {
      results = (await apiPost('/inventory/opening-balance', { ...preview, idempotency_key: attempt.current.key })).results
    } catch (e: any) {
      if (e instanceof ApiError && Array.isArray(e.data?.results)) results = e.data.results
      else {
        setBanner({ tone: 'danger', text: e.code === 'NETWORK_ERROR' ? 'لم يتم التسجيل بسبب انقطاع الاتصال. الأسطر محفوظة، أعد المحاولة.' : e.message })
        setConfirming(false); setSubmitting(false); return
      }
    }
    const outcome = applyOpeningResults(lines, results ?? [])
    setLines(outcome.remaining); setConfirming(false); setSubmitting(false); attempt.current = null
    if (outcome.rejected) setBanner({ tone: 'warn', text: `سُجّل ${outcome.posted} صنف وتعذّر ${outcome.rejected}. راجع الأسطر المعلّمة.` })
    if (outcome.posted) { toast.success(`تم تسجيل الرصيد الافتتاحي لـ ${outcome.posted} صنف`); if (!outcome.rejected) setDone(outcome.posted) }
    setShowErrors(false)
  }

  if (!allowed) return <NoPermission />
  return (
    <div className="space-y-4">
      <PageHeader title="الرصيد الافتتاحي" subtitle="أدخل كمية وتكلفة كل صنف عند بداية التشغيل." back={{ href: '/inventory', label: 'المخزون' }} />
      {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}
      {draftOffer > 0 && (
        <Banner tone="info" action={<span className="flex gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => { setLines(loadDraft(localStorage, branchId).map(d => ({ ...d }))); setDraftOffer(0) }}>متابعة</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => { saveDraft(localStorage, branchId, []); setDraftOffer(0) }}>مسح</button></span>}>
          لديك {draftOffer} سطر لم يُسجَّل.
        </Banner>
      )}
      <div className="card sticky top-14 z-20 space-y-3 md:top-0">
        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <Field label="الفرع" required hint={lines.length ? 'لتغيير الفرع احفظ أو احذف الأسطر الحالية' : undefined}>
            {branchesLoading ? <div className="h-11 animate-pulse rounded-xl bg-gray-100" /> : (
              <select className="select" value={branchId} disabled={lines.length > 0} onChange={e => setBranchId(e.target.value)}>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </Field>
          <div className="space-y-2">
            <ItemPicker
              ref={picker} autoFocus branchId={branchId} excludeTracked onPick={addItem} onUnknownBarcode={setUnknown}
              disabledWhen={i => (i.available ? 'له رصيد مسجل بالفعل — لتعديله استخدم تسوية مخزون.' : undefined)}
            />
            <button type="button" className="btn-secondary btn-sm" disabled={!pending || !branchId} onClick={addAllPending}>
              إضافة كل الأصناف بلا رصيد ({pending ?? '—'})
            </button>
          </div>
        </div>
        {unknown && (
          <div role="alert" className="alert-danger flex flex-wrap items-center justify-between gap-2">
            <span>الباركود <bdi dir="ltr" className="font-mono">{unknown}</bdi> غير موجود في المنتجات.</span>
            <span className="flex gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => { picker.current?.setQuery(unknown); setUnknown(null) }}>بحث يدوي</button>
              <a className="btn-secondary btn-sm" href="/products/new" target="_blank" rel="noreferrer">إضافة منتج جديد</a>
            </span>
          </div>
        )}
      </div>
      {done !== null && (
        <div className="card text-center">
          <p className="font-bold text-green-800">✓ تم تسجيل الرصيد الافتتاحي لـ {done} صنف</p>
          <div className="mt-3 flex justify-center gap-2"><button className="btn" onClick={() => { setDone(null); picker.current?.focus() }}>إدخال المزيد</button><Link className="btn-secondary" href="/inventory">الذهاب للأرصدة</Link></div>
        </div>
      )}
      {lines.length > 0 ? (
        <div className="card p-2 md:p-3">
          <OpeningLines lines={lines} needCost showErrors={showErrors} flashId={flashId} onChange={change} setRef={setRef} onEnter={onEnter}
            onRemove={id => setLines(cur => cur.filter(l => l.item.id !== id))} />
        </div>
      ) : done === null && (
        pending === 0
          ? <EmptyState title="كل أصنافك لها رصيد افتتاحي" action={<Link className="btn-link" href="/inventory">الأرصدة</Link>} />
          : <EmptyState title="لم تُضف أصناف بعد" hint="امسح باركود أي صنف أو ابحث بالاسم لتبدأ." />
      )}
      <StickyActionBar>
        <div className="flex flex-col gap-1">
          <button type="button" className="btn btn-lg" disabled={!!reason || submitting} onClick={() => { setShowErrors(true); if (!invalid) setConfirming(true) }}>تسجيل الرصيد الافتتاحي</button>
          {reason && <span className="text-xs text-gray-600">{reason}</span>}
        </div>
        <div className="text-sm font-medium">{sum.items} صنف · إجمالي القيمة <bdi dir="ltr" className="tabular-nums">{formatMoney(sum.value, { unit: false })}</bdi> ج.م</div>
      </StickyActionBar>
      <ConfirmDialog open={confirming} title="تسجيل الرصيد الافتتاحي" confirmLabel="تسجيل" loading={submitting} onConfirm={submit} onClose={() => setConfirming(false)}>
        <p>سيتم تسجيل {sum.items} صنف في {branchName} بقيمة {formatMoney(sum.value, { unit: false })} ج.م. بعد التسجيل يتغيّر رصيد المخزون ولا يمكن التراجع؛ التصحيح يكون بتسوية مخزون.</p>
      </ConfirmDialog>
    </div>
  )
}

export default function OpeningBalancePage() {
  return <Suspense><OpeningBalance /></Suspense>
}
