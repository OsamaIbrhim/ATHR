'use client'
import { itemTitle } from '@/lib/items'
import { lineValue, validateOpeningLine, type OpeningLine } from '@/lib/opening'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Num from '@/components/ui/Num'
import { useIsDesktop } from '@/lib/use-media'
import NumberInput from '@/components/ui/NumberInput'

export type FieldRefSetter = (variantId: string, field: 'qty' | 'cost', el: HTMLInputElement | null) => void

export default function OpeningLines({ lines, needCost, showErrors, flashId, onChange, onRemove, setRef, onEnter }: {
  lines: OpeningLine[]
  needCost: boolean
  showErrors: boolean
  flashId: string | null
  onChange: (id: string, patch: Partial<OpeningLine>) => void
  onRemove: (id: string) => void
  setRef: FieldRefSetter
  onEnter: (id: string, field: 'qty' | 'cost') => void
}) {
  const desktop = useIsDesktop()
  const qtyInput = (line: OpeningLine) => {
    const err = showErrors ? validateOpeningLine(line, { needCost }).qty : undefined
    return (
      <NumberInput
        ref={el => setRef(line.item.id, 'qty', el)}
        value={line.qty} precision={line.precision} ariaLabel={`الكمية الافتتاحية — ${itemTitle(line.item)}`}
        error={err} onChange={qty => onChange(line.item.id, { qty, serverError: undefined })} onEnter={() => onEnter(line.item.id, 'qty')}
      />
    )
  }
  const costInput = (line: OpeningLine) => {
    const v = validateOpeningLine(line, { needCost })
    return (
      <div>
        <NumberInput
          ref={el => setRef(line.item.id, 'cost', el)}
          value={line.cost} precision={4} unit="ج.م" ariaLabel={`التكلفة للوحدة — ${itemTitle(line.item)}`}
          error={showErrors ? v.cost : undefined}
          onChange={cost => onChange(line.item.id, { cost, costFromItem: false, serverError: undefined })} onEnter={() => onEnter(line.item.id, 'cost')}
        />
        {line.costFromItem && <span className="mt-1 block text-xs text-gray-600">من بيانات الصنف</span>}
        {v.warn && <span className="mt-1 block text-xs text-amber-800">⚠ {v.warn}</span>}
      </div>
    )
  }
  const title = (line: OpeningLine) => (
    <div>
      <div className="font-medium text-gray-900">
        {itemTitle(line.item)}
        {line.packQty > 1 && <span className="badge-info ms-2">×{line.packQty}</span>}
        {flashId === line.item.id && <span className="badge-warn ms-2">+1</span>}
      </div>
      <bdi dir="ltr" className="font-mono text-xs text-gray-600">{line.item.sku}</bdi>
      {line.serverError && <div role="alert" className="mt-1 text-sm text-red-700">⚠ {line.serverError}</div>}
    </div>
  )
  const removeBtn = (line: OpeningLine) => (
    <button type="button" className="btn-icon" aria-label="حذف السطر" onClick={() => onRemove(line.item.id)}>✕</button>
  )
  const columns: Column<OpeningLine>[] = [
    { header: 'الصنف', cell: title },
    { header: 'الكمية الحالية في النظام', align: 'end', cell: l => l.item.available ? <Num value={l.item.available} kind="qty" className="text-gray-600" /> : <span className="text-gray-600">لا يوجد</span> },
    { header: 'الكمية الافتتاحية', key: 'qty', className: 'w-40', cell: qtyInput },
    ...(needCost ? [
      { header: 'التكلفة للوحدة', key: 'cost', className: 'w-48', cell: costInput } as Column<OpeningLine>,
      { header: 'قيمة السطر', align: 'end', cell: (l: OpeningLine) => <Num value={lineValue(l)} kind="money" /> } as Column<OpeningLine>,
    ] : []),
    { header: '', key: 'remove', cell: removeBtn },
  ]
  const card = (l: OpeningLine) => (
    <li key={l.item.id} className={`space-y-2 rounded-xl border border-gray-200 bg-white p-3 ${flashId === l.item.id ? 'bg-amber-50' : ''} ${l.serverError ? 'border-red-600' : ''}`}>
      <div className="flex items-start justify-between gap-2">{title(l)}{removeBtn(l)}</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-600">الكمية{qtyInput(l)}</label>
        {needCost && <label className="text-xs text-gray-600">التكلفة{costInput(l)}</label>}
      </div>
      {needCost && <div className="text-end text-sm">القيمة: <Num value={lineValue(l)} kind="money" /></div>}
    </li>
  )
  if (!desktop) return <ul className="space-y-3">{lines.map(card)}</ul>
  return (
    <DataTable
      columns={columns}
      rows={lines}
      rowKey={l => l.item.id}
      caption="أسطر الرصيد الافتتاحي"
      rowClassName={l => `${flashId === l.item.id ? 'bg-amber-50' : ''} ${l.serverError ? 'border-s-4 border-red-600' : ''}`}
    />
  )
}
