'use client'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { apiGet, apiPost, ApiError } from '@/lib/api'
import { defaultCountName } from '@/lib/counts'
import { formatDate } from '@/lib/format'
import type { BranchOption } from '@/lib/use-branches'
import Field from '@/components/ui/Field'
import { Banner } from '@/components/ui/PageStates'

type ScopeType = 'all' | 'product_type'

/** Dialog on desktop, full screen on phones. Starts a count and returns its id. */
export default function StartCountDialog({ branches, defaultBranchId, onClose, onStarted }: {
  branches: BranchOption[]
  defaultBranchId: string
  onClose: () => void
  onStarted: (id: string) => void
}) {
  const titleId = useId()
  const [branchId, setBranchId] = useState(defaultBranchId || branches[0]?.id || '')
  const [scope, setScope] = useState<ScopeType>('all')
  const [typeId, setTypeId] = useState('')
  const [types, setTypes] = useState<{ id: string; name: string }[]>([])
  const [name, setName] = useState('')
  const [size, setSize] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [openCountId, setOpenCountId] = useState<string | null>(null)
  const commandId = useState(() => `count-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)[0]
  const branchName = branches.find(b => b.id === branchId)?.name ?? ''

  useEffect(() => {
    apiGet('/product-types').then((r: any) => {
      const list: any[] = Array.isArray(r) ? r : r?.items ?? []
      setTypes(list.map(t => ({ id: String(t.id), name: t.name_ar || t.name_en || t.name })))
    }).catch(() => setTypes([]))
  }, [])
  useEffect(() => {
    setSize(null)
    if (!branchId || (scope === 'product_type' && !typeId)) return
    const q = new URLSearchParams({ branch_id: branchId, scope_type: scope, ...(scope === 'product_type' ? { scope_id: typeId } : {}) })
    let cancelled = false
    apiGet(`/inventory/counts/scope-size?${q}`).then(r => { if (!cancelled) setSize(Number(r.items)) }).catch(() => { if (!cancelled) setSize(null) })
    return () => { cancelled = true }
  }, [branchId, scope, typeId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const start = async () => {
    setBusy(true); setError(''); setOpenCountId(null)
    try {
      const created = await apiPost('/inventory/counts', {
        branch_id: branchId, scope: scope === 'all' ? { type: 'all' } : { type: 'product_type', id: typeId },
        ...(name.trim() ? { name: name.trim() } : {}), command_id: commandId,
      })
      onStarted(created.id)
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'STOCK_COUNT_ALREADY_OPEN') { setOpenCountId(e.data?.count_id ?? null); setError('يوجد جرد جارٍ لهذا الفرع.') }
      else if (e instanceof ApiError && e.code === 'STOCK_COUNT_EMPTY_SCOPE') setError('لا توجد أصناف في هذا النطاق.')
      else setError(e.message || 'تعذر بدء الجرد.')
      setBusy(false)
    }
  }
  const blocked = busy || !branchId || (scope === 'product_type' && !typeId) || size === 0

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 md:items-center md:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex w-full max-w-lg flex-col gap-4 overflow-auto bg-white p-5 md:max-h-[90vh] md:rounded-2xl">
        <h2 id={titleId} className="text-lg font-bold">بدء جرد جديد</h2>
        <Field label="الفرع" required>
          <select className="select" value={branchId} onChange={e => setBranchId(e.target.value)}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-gray-700">النطاق</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />كل أصناف الفرع</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="scope" checked={scope === 'product_type'} onChange={() => setScope('product_type')} />نوع منتج محدد</label>
          {scope === 'product_type' && (
            <select className="select" aria-label="نوع المنتج" value={typeId} onChange={e => setTypeId(e.target.value)}>
              <option value="">اختر نوع المنتج</option>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          {size !== null && <p className="text-sm text-gray-700">{size} صنف في هذا النطاق</p>}
          {size === 0 && <p role="alert" className="text-sm text-red-700">لا توجد أصناف في هذا النطاق.</p>}
        </fieldset>
        <Field label="الاسم (اختياري)">
          <input className="input" maxLength={200} placeholder={defaultCountName(branchName, formatDate(new Date()))} value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Banner tone="info">المبيعات تستمر أثناء الجرد. نحسب المتوقع لكل صنف وقت عدّه، فلا تحتاج لإيقاف البيع.</Banner>
        {error && (
          <Banner tone="danger" action={openCountId ? <Link className="btn-secondary btn-sm" href={`/inventory/counts/${openCountId}`}>فتح الجرد الجاري</Link> : undefined}>{error}</Banner>
        )}
        <div className="mt-auto flex gap-2">
          <button type="button" className="btn btn-lg" disabled={blocked} aria-busy={busy || undefined} onClick={start}>{busy ? 'جارٍ…' : 'بدء الجرد'}</button>
          <button type="button" className="btn-secondary btn-lg" disabled={busy} onClick={onClose}>رجوع</button>
        </div>
      </div>
    </div>
  )
}
