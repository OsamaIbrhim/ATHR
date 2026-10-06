'use client'
import { itemTitle } from '@/lib/items'
import { afterOf, deltaOf, reasonLabel, REASONS, validateAdjustmentLine, valueOf, type AdjustmentLine } from '@/lib/adjustments'
import { useIsDesktop } from '@/lib/use-media'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Num from '@/components/ui/Num'
import NumberInput from '@/components/ui/NumberInput'

export default function AdjustmentLines({ lines, editable, showValue, showErrors, lineErrors, setRef, onChange, onRemove, onQtyEnter }: {
  lines: AdjustmentLine[]
  editable: boolean
  showValue: boolean
  showErrors: boolean
  /** Server-side messages keyed by line index. */
  lineErrors: Record<number, string>
  setRef: (variantId: string, el: HTMLInputElement | null) => void
  onChange: (index: number, patch: Partial<AdjustmentLine>) => void
  onRemove: (index: number) => void
  onQtyEnter: () => void
}) {
  const desktop = useIsDesktop()
  const indexOf = (line: AdjustmentLine) => lines.indexOf(line)
  const direction = (line: AdjustmentLine) => {
    const d = deltaOf(line)
    return d === 0 ? null : d > 0 ? <span className="badge-ok">زيادة</span> : <span className="badge-danger">نقص</span>
  }
  const title = (line: AdjustmentLine) => (
    <div>
      <div className="font-medium text-gray-900">{itemTitle(line.item)}</div>
      <bdi dir="ltr" className="font-mono text-xs text-gray-600">{line.item.sku}</bdi>
      {lineErrors[indexOf(line)] && <div role="alert" className="mt-1 text-sm text-red-700">⚠ {lineErrors[indexOf(line)]}</div>}
      {line.locked && <div className="text-xs text-gray-600">🔒 مغلقة بعد الاعتماد</div>}
    </div>
  )
  const qty = (line: AdjustmentLine) => {
    const errors = showErrors ? validateAdjustmentLine(line) : {}
    if (!editable) return <Num value={line.qty} kind="qty" signed tone="auto" />
    return (
      <div className="flex items-start gap-2">
        <NumberInput ref={el => setRef(line.item.id, el)} value={line.qty} precision={line.precision} allowSign error={errors.qty}
          ariaLabel={`الكمية +/− — ${itemTitle(line.item)}`} onChange={v => onChange(indexOf(line), { qty: v })} onEnter={onQtyEnter} />
        <span className="pt-2">{direction(line)}</span>
      </div>
    )
  }
  const reason = (line: AdjustmentLine) => {
    if (!editable) return reasonLabel(line.reason)
    const errors = showErrors ? validateAdjustmentLine(line) : {}
    return (
      <div>
        <select className="select" aria-label={`السبب — ${itemTitle(line.item)}`} aria-invalid={errors.reason ? true : undefined} value={line.reason} onChange={e => onChange(indexOf(line), { reason: e.target.value })}>
          <option value="">اختر السبب</option>
          {REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
        {errors.reason && <span role="alert" className="text-xs text-red-700">⚠ {errors.reason}</span>}
      </div>
    )
  }
  const note = (line: AdjustmentLine) => {
    if (!editable) return line.note || '—'
    const errors = showErrors ? validateAdjustmentLine(line) : {}
    return (
      <div>
        <input className="input" aria-label={`ملاحظة — ${itemTitle(line.item)}`} maxLength={300} aria-invalid={errors.note ? true : undefined} value={line.note} onChange={e => onChange(indexOf(line), { note: e.target.value })} />
        {errors.note && <span role="alert" className="text-xs text-red-700">⚠ {errors.note}</span>}
      </div>
    )
  }
  const after = (line: AdjustmentLine) => {
    const value = afterOf(line)
    if (value === null) return '—'
    return <span><Num value={value} kind="qty" />{value < 0 && <span className="badge-warn ms-1">بالسالب</span>}</span>
  }
  const impact = (line: AdjustmentLine) => { const v = valueOf(line); return v === null ? '—' : <Num value={v} kind="money" signed tone="auto" /> }
  const remove = (line: AdjustmentLine) => editable && <button type="button" className="btn-icon" aria-label="حذف السطر" onClick={() => onRemove(indexOf(line))}>✕</button>

  if (!desktop) {
    return (
      <ul className="space-y-3">
        {lines.map(line => (
          <li key={line.item.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">{title(line)}{remove(line)}</div>
            <div className="text-sm text-gray-600">الرصيد الحالي: {line.onHand === null ? '—' : <Num value={line.onHand} kind="qty" />} · بعد التسوية: {after(line)}</div>
            <div>{qty(line)}</div>
            <div>{reason(line)}</div>
            {(editable || line.note) && <div>{note(line)}</div>}
            {showValue && <div className="text-end text-sm">الأثر: {impact(line)}</div>}
          </li>
        ))}
      </ul>
    )
  }
  const columns: Column<AdjustmentLine>[] = [
    { header: 'الصنف', cell: title },
    { header: 'الرصيد الحالي', align: 'end', cell: l => l.onHand === null ? '—' : <Num value={l.onHand} kind="qty" className="text-gray-600" /> },
    { header: 'الكمية +/−', key: 'qty', className: 'w-56', cell: qty },
    { header: 'السبب', cell: reason, className: 'w-48' },
    { header: 'ملاحظة', cell: note },
    ...(showValue ? [{ header: 'الأثر على القيمة', align: 'end', cell: impact } as Column<AdjustmentLine>] : []),
    { header: 'الرصيد بعد التسوية', align: 'end', cell: after },
    { header: '', key: 'remove', cell: remove },
  ]
  return <DataTable columns={columns} rows={lines} rowKey={l => l.item.id} caption="أسطر التسوية" />
}
