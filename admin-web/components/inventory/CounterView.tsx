'use client'
import { useRouter } from 'next/navigation'
import { setLeaveGuard } from '@/lib/leave-guard'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCounter } from '@/lib/use-counter'
import { variantName, type MineRow, type VariantLite } from '@/lib/counts'
import type { PickedItem } from '@/lib/items'
import { isBarcodeLike } from '@/lib/counts'
import CameraScan from './CameraScan'
import ItemPicker, { type ItemPickerHandle } from '@/components/ui/ItemPicker'
import Num from '@/components/ui/Num'
import NumberInput from '@/components/ui/NumberInput'
import { Banner } from '@/components/ui/PageStates'
import StickyActionBar from '@/components/ui/StickyActionBar'

const lite = (item: PickedItem): VariantLite => ({ id: item.id, sku: item.sku, label: item.label, name_ar: item.name, name_en: null })
const beep = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator(); osc.frequency.value = 880; osc.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.08)
  } catch { /* no audio */ }
}

export default function CounterView({ countId, count, canReview, canAddOutOfScope, onReview }: {
  countId: string
  count: { name: string; status: string }
  canReview: boolean
  canAddOutOfScope: boolean
  onReview: () => void
}) {
  const open = count.status === 'open'
  const c = useCounter(countId, open)
  const router = useRouter()
  const [leaveTo, setLeaveTo] = useState<string | null>(null)
  const picker = useRef<ItemPickerHandle>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [infoHidden, setInfoHidden] = useState(false)
  const [finished, setFinished] = useState(false)
  const [sound, setSound] = useState(false)
  const [announce, setAnnounce] = useState('')
  const last = c.state.last

  useEffect(() => { try { setSound(localStorage.getItem('athr.count.beep') === '1') } catch { /* ignore */ } }, [])
  useEffect(() => {
    if (!last) return
    if (last.kind === 'counted') { navigator.vibrate?.(40); if (sound) beep(); setAnnounce(`تم عدّ ${variantName(last.variant)}: ${last.mine}`) }
    else { navigator.vibrate?.([80, 60, 80, 60, 80]); setAnnounce('تعذر عدّ الصنف') }
  }, [last, sound])

  // Keep the screen awake while counting, and warn before leaving with unsent scans.
  useEffect(() => {
    let lock: any = null
    const acquire = async () => { try { lock = await (navigator as any).wakeLock?.request('screen') } catch { /* optional */ } }
    void acquire()
    const visible = () => { if (document.visibilityState === 'visible') void acquire() }
    document.addEventListener('visibilitychange', visible)
    return () => { document.removeEventListener('visibilitychange', visible); void lock?.release?.() }
  }, [])
  useEffect(() => {
    if (!c.pending) return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [c.pending])
  useEffect(() => {
    if (!c.pending) return
    setLeaveGuard(href => setLeaveTo(href))
    return () => setLeaveGuard(null)
  }, [c.pending])

  // +/- adjust the last item while the field is empty; Ctrl+Z undoes the last scan; Escape returns to the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const field = document.activeElement as HTMLInputElement | null
      const typing = field && field.tagName === 'INPUT' && field.value !== ''
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); c.undoLast() }
      else if (e.key === 'Escape') picker.current?.focus()
      else if (!typing && last?.kind === 'counted' && (e.key === '+' || e.key === '-') && !editing) { e.preventDefault(); c.change(last.variant, { add: e.key === '+' ? 1 : -1 }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [c, last, editing])

  const commit = (variant: VariantLite) => { const n = Number(draft); if (draft !== '' && Number.isFinite(n)) c.change(variant, { set: n }); setEditing(null); picker.current?.focus() }
  const scan = useCallback((code: string) => c.scanBarcode(code), [c])
  const shown = c.rows.filter(r => !search || `${variantName(r.variant)} ${r.variant.sku}`.toLowerCase().includes(search.toLowerCase()))
  const roundBtn = 'flex h-14 w-14 items-center justify-center rounded-full border border-gray-300 bg-white text-3xl leading-none hover:bg-gray-50'

  const card = () => {
    if (!last) return <div className="card text-center text-gray-600">امسح أول صنف لتبدأ.</div>
    if (last.kind === 'unknown') return (
      <div role="alert" className="card border-2 border-red-600 bg-red-50 text-center">
        <div className="text-lg font-bold text-red-800">باركود غير معروف</div>
        <bdi dir="ltr" className="font-mono text-lg">{last.code}</bdi>
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" className="btn-secondary min-h-12" onClick={() => { picker.current?.setQuery(last.code); c.dismissLast() }}>بحث بالاسم</button>
          <button type="button" className="btn-secondary min-h-12" onClick={c.dismissLast}>تجاهل</button>
        </div>
      </div>
    )
    if (last.kind === 'out_of_scope') return (
      <div role="alert" className="card border-2 border-amber-500 bg-amber-50 text-center">
        <div className="font-bold text-amber-900">هذا الصنف خارج نطاق الجرد</div>
        {last.variant && <div>{variantName(last.variant)}</div>}
        <div className="mt-3 flex justify-center gap-2">
          {canAddOutOfScope && last.variant && <button type="button" className="btn min-h-12" onClick={() => { c.allowOutOfScope(last.variant!.id); c.dismissLast() }}>أضفه للجرد</button>}
          <button type="button" className="btn-secondary min-h-12" onClick={c.dismissLast}>تجاهل</button>
        </div>
      </div>
    )
    if (last.kind === 'problem') return <div role="alert" className="card border-2 border-amber-500 bg-amber-50 text-center font-medium">{last.message}</div>
    const v = last.variant
    return (
      <div className="card border-2 border-green-600 text-center">
        <div className="text-lg font-bold text-gray-900">{variantName(v)}</div>
        <div className="text-sm text-gray-600">{v.label} <bdi dir="ltr" className="font-mono">{v.sku}</bdi></div>
        <div className="my-3 flex items-center justify-center gap-4">
          <button type="button" className={roundBtn} aria-label="إنقاص الكمية" disabled={!open} onClick={() => c.change(v, { add: -1 })}>−</button>
          {editing === 'last' ? (
            <div className="w-32"><NumberInput autoFocus value={draft} onChange={setDraft} precision={3} ariaLabel="الكمية المعدودة" size="lg" onEnter={() => commit(v)} /></div>
          ) : (
            <button type="button" className="min-w-24 text-5xl font-bold tabular-nums" aria-label="تعديل الكمية" onClick={() => { setDraft(String(last.mine)); setEditing('last') }}><Num value={last.mine} kind="qty" /></button>
          )}
          <button type="button" className={roundBtn} aria-label="زيادة الكمية" disabled={!open} onClick={() => c.change(v, { add: 1 })}>+</button>
        </div>
        <div className="text-sm text-gray-700">عددت أنت <Num value={last.mine} kind="qty" /> · الإجمالي <Num value={last.total} kind="qty" />{last.packQty > 1 && <span className="badge-info ms-2">×{last.packQty}</span>}</div>
        {editing === 'last' && <button type="button" className="btn mt-2 min-h-12" onClick={() => commit(v)}>حفظ</button>}
      </div>
    )
  }
  const row = (r: MineRow) => (
    <li key={r.variant.id} className="flex items-center gap-2 border-b border-gray-100 py-2">
      <div className="min-w-0 flex-1"><div className="truncate font-medium">{variantName(r.variant)}</div><bdi dir="ltr" className="font-mono text-xs text-gray-600">{r.variant.sku}</bdi></div>
      {editing === r.variant.id
        ? <div className="flex items-center gap-1"><div className="w-24"><NumberInput value={draft} onChange={setDraft} precision={3} ariaLabel={`الكمية — ${variantName(r.variant)}`} onEnter={() => commit(r.variant)} /></div><button type="button" className="btn btn-sm" onClick={() => commit(r.variant)}>حفظ</button></div>
        : <><span className="text-lg font-bold"><Num value={r.mine} kind="qty" /></span>
          <button type="button" className="btn-link" disabled={!open} onClick={() => { setDraft(String(r.mine)); setEditing(r.variant.id) }}>تعديل</button>
          <button type="button" className="btn-danger-link" disabled={!open} onClick={() => c.change(r.variant, { set: 0 })}>حذف</button></>}
    </li>
  )

  return (
    <div className="space-y-3 pb-2">
      <div className="sr-only" aria-live="polite">{announce}</div>
      {!open && <Banner tone="danger">هذا الجرد أُغلق. لم يعد يقبل العدّ.</Banner>}
      {c.closed && open && <Banner tone="danger">هذا الجرد أُغلق. لم يعد يقبل العدّ.</Banner>}
      {c.status === 'offline' && c.pending > 0 && <Banner tone="warn">لا يوجد اتصال. عدّك محفوظ على هذا الجهاز وسيُرسل تلقائيًا.</Banner>}
      {!infoHidden && <Banner tone="info" action={<button type="button" className="btn-link" onClick={() => setInfoHidden(true)}>إخفاء</button>}>المبيعات مستمرة أثناء الجرد.</Banner>}
      <div className="grid gap-4 md:grid-cols-5">
        <div className="space-y-3 md:col-span-2">
          <div className="sticky top-14 z-20 -mx-4 bg-surface px-4 pb-2 pt-1 md:static md:mx-0 md:p-0">
            <ItemPicker
              ref={picker} autoFocus size="lg" disabled={!open || c.closed} excludeTracked placeholder="امسح الباركود أو اكتب الاسم"
              onRawSubmit={text => { if (isBarcodeLike(text)) { scan(text); return true } return false }}
              onPick={(item, o) => c.change(lite(item), { add: o.packQty })}
              onUnknownBarcode={scan}
              endAdornment={<CameraScan onCode={scan} disabled={!open} />}
            />
            <div className="mt-1 text-end text-xs font-medium text-gray-700" role="status">{c.label}</div>
          </div>
          {card()}
          {c.undo && <button type="button" className="btn-secondary min-h-12 w-full" onClick={c.undoLast}>تراجع عن آخر مسح</button>}
        </div>
        <section className="card md:col-span-3" aria-label="ما عددته">
          <div className="mb-2 flex items-center justify-between gap-2">
            <input className="input" aria-label="ابحث فيما عددته" placeholder="ابحث فيما عددته" value={search} onChange={e => setSearch(e.target.value)} />
            <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={sound} onChange={e => { setSound(e.target.checked); try { localStorage.setItem('athr.count.beep', e.target.checked ? '1' : '0') } catch { /* ignore */ } }} />صوت</label>
          </div>
          {shown.length ? <ul>{shown.map(row)}</ul> : <div className="py-8 text-center text-sm text-gray-600"><div className="font-medium text-gray-800">لم تعدّ شيئًا بعد</div>امسح أول صنف لتبدأ.</div>}
        </section>
      </div>
      <ConfirmDialog open={!!leaveTo} title="تغادر الجرد؟" confirmLabel="مغادرة" cancelLabel="البقاء" tone="danger" onClose={() => setLeaveTo(null)} onConfirm={() => { const to = leaveTo; setLeaveTo(null); if (to) router.push(to) }}>
        فيه مسحات لم تُرسل بعد للخادم. لو غادرت الآن قد تضيع.
      </ConfirmDialog>
      <StickyActionBar>
        {finished ? <p className="font-medium text-green-800">تم حفظ عدّك. أبلغ المسؤول ليراجع الجرد.</p>
          : <button type="button" className="btn btn-lg w-full md:w-auto" disabled={!open} onClick={() => (canReview ? onReview() : setFinished(true))}>{canReview ? 'انتهيت — مراجعة الفروق' : 'انتهيت من عدّي'}</button>}
        <span className="text-sm text-gray-700">عُدّ <Num value={c.rows.length} /> صنف · <Num value={c.units} kind="qty" /> وحدة</span>
      </StickyActionBar>
    </div>
  )
}
