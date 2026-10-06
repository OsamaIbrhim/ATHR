'use client'
import { duplicateColumns, FIELDS, missingFields, sampleColumns, type FieldKey, type Mapping } from '@/lib/import/mapping'
import type { BranchOption } from '@/lib/use-branches'
import Field from '@/components/ui/Field'
import StatusBadge from '@/components/ui/StatusBadge'

export default function MappingStep({ headers, dataRows, mapping, auto, branches, branchId, taxMode, onMapping, onBranch, onTaxMode, onBack, onNext }: {
  headers: string[] | null
  dataRows: string[][]
  mapping: Mapping
  auto: Mapping
  branches: BranchOption[]
  branchId: string
  taxMode: 'inclusive' | 'exclusive'
  onMapping: (key: FieldKey, column: number | null) => void
  onBranch: (id: string) => void
  onTaxMode: (mode: 'inclusive' | 'exclusive') => void
  onBack: () => void
  onNext: () => void
}) {
  const width = Math.max(headers?.length ?? 0, dataRows.reduce((w, r) => Math.max(w, r.length), 0))
  const samples = sampleColumns(dataRows.slice(0, 200), 3)
  const dupes = duplicateColumns(mapping)
  const missing = missingFields(mapping)
  const qtyMapped = mapping.qty !== null
  const problem = missing.length ? `اربط: ${missing.join('، ')}` : dupes.size ? 'كل حقل يحتاج عمودًا مختلفًا.' : qtyMapped && !branchId ? 'اختر الفرع الذي تُسجَّل فيه الكميات.' : ''
  const unused = Array.from({ length: width }, (_, c) => c).filter(c => !Object.values(mapping).includes(c))
  const label = (c: number) => (headers?.[c]?.trim() || `عمود ${c + 1}`)
  const status = (key: FieldKey) => {
    if (mapping[key] === null) return FIELDS.find(f => f.key === key)!.required ? <StatusBadge tone="warn">اختر العمود</StatusBadge> : <StatusBadge tone="neutral">غير مستخدم</StatusBadge>
    return mapping[key] === auto[key] ? <StatusBadge tone="ok">تم التعرف تلقائيًا</StatusBadge> : <StatusBadge tone="info">اخترته بنفسك</StatusBadge>
  }
  const select = (key: FieldKey) => (
    <select className="select" aria-label={`عمود الملف لـ ${FIELDS.find(f => f.key === key)!.label}`} aria-invalid={dupes.has(key) ? true : undefined}
      value={mapping[key] ?? ''} onChange={e => onMapping(key, e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">— لا يوجد —</option>
      {Array.from({ length: width }, (_, c) => <option key={c} value={c}>{label(c)}</option>)}
    </select>
  )
  const chips = (key: FieldKey) => {
    const c = mapping[key]
    return c === null ? null : <div className="flex flex-wrap gap-1">{(samples[c] ?? []).map((v, i) => <bdi key={i} dir="ltr" className="max-w-[9rem] truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">{v}</bdi>)}</div>
  }
  const warn = (key: FieldKey) => key === 'cost' && qtyMapped && mapping.cost === null
    ? <p className="mt-1 text-xs text-amber-800">⚠ بدون تكلفة ستُسجَّل الكمية بتكلفة صفر وتظهر أرباح غير صحيحة.</p>
    : dupes.has(key) ? <p role="alert" className="mt-1 text-xs text-red-700">⚠ هذا العمود مربوط بحقل آخر</p> : null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="أسعار البيع في ملفك" hint="قرار ضروري: الخطأ فيه يغيّر سعر كل بيع.">
          <select className="select" value={taxMode} onChange={e => onTaxMode(e.target.value as 'inclusive' | 'exclusive')}>
            <option value="inclusive">شاملة الضريبة</option><option value="exclusive">غير شاملة الضريبة</option>
          </select>
        </Field>
        {qtyMapped && (
          <Field label="سجّل الكميات في فرع" required>
            <select className="select" value={branchId} onChange={e => onBranch(e.target.value)}>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
        )}
      </div>
      <table className="hidden md:table">
        <thead><tr><th>حقل ATHR</th><th>عمود الملف</th><th>أمثلة من الملف</th><th>الحالة</th></tr></thead>
        <tbody>
          {FIELDS.map(f => (
            <tr key={f.key}>
              <td><div className="font-medium">{f.label} <span className={f.required ? 'badge-danger' : 'text-xs text-gray-600'}>{f.required ? 'مطلوب' : 'اختياري'}</span></div>{f.hint && <div className="text-xs text-gray-600">{f.hint}</div>}</td>
              <td className="w-64">{select(f.key)}{warn(f.key)}</td><td>{chips(f.key)}</td><td>{status(f.key)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-3 md:hidden">
        {FIELDS.map(f => (
          <div key={f.key} className="card space-y-2">
            <div className="font-medium">{f.label} <span className={f.required ? 'badge-danger' : 'text-xs text-gray-600'}>{f.required ? 'مطلوب' : 'اختياري'}</span></div>
            {select(f.key)}{warn(f.key)}{chips(f.key)}{status(f.key)}
          </div>
        ))}
      </div>
      {unused.length > 0 && <div className="text-sm text-gray-700">أعمدة في الملف لن تُستورد: <span className="inline-flex flex-wrap gap-1 align-middle">{unused.map(c => <span key={c} className="tag">{label(c)}</span>)}</span></div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-lg" disabled={!!problem} onClick={onNext}>فحص الملف</button>
        <button type="button" className="btn-secondary btn-lg" onClick={onBack}>رجوع</button>
        {problem && <span className="text-sm text-gray-600">{problem}</span>}
      </div>
    </div>
  )
}
