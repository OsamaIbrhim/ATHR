'use client'
import type { VariantRow } from '@/lib/catalog/form-model'
import type { AttributeDefinition } from '@/lib/catalog/types'
import { variantLabel } from '@/lib/catalog/variant-label'
import BarcodeList from './BarcodeList'

/**
 * One row per variant. Cost is typed only for new variants: an existing
 * variant's cost changes through purchasing (the cost ledger), never here.
 */
export default function VariantMatrix({ rows, definitions, onChange, precision }: {
  rows: VariantRow[]
  definitions: AttributeDefinition[]
  onChange: (rows: VariantRow[]) => void
  precision?: number
}) {
  const hasAxes = definitions.some(definition => definition.axis)
  const update = (key: string, patch: Partial<VariantRow>) =>
    onChange(rows.map(row => (row.key === key ? { ...row, ...patch } : row)))

  return (
    <div className="overflow-auto rounded-xl border border-gray-200">
      <table>
        <thead>
          <tr>
            <th className="w-12">فعال</th>
            {hasAxes && <th>الصنف (معاينة الاسم)</th>}
            <th>SKU</th>
            <th>التكلفة (ج)</th>
            <th>الباركود</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const locked = !!row.id
            const inactiveOnServer = locked && !row.active
            return (
              <tr key={row.key} className={row.active ? '' : 'opacity-50'} data-testid="variant-row">
                <td>
                  <input type="checkbox" aria-label="تفعيل الصنف" checked={row.active}
                    disabled={inactiveOnServer}
                    title={inactiveOnServer ? 'لا يمكن إعادة تفعيل صنف معطّل من هنا' : undefined}
                    onChange={event => update(row.key, { active: event.target.checked })} />
                </td>
                {hasAxes && (
                  <td>
                    <span className="badge bg-gray-100 text-gray-800 text-sm">{variantLabel(definitions, row.attributes)}</span>
                    {locked && <span className="mr-1 text-[11px] text-gray-400">محفوظ</span>}
                  </td>
                )}
                <td>
                  <input className="input-sm min-w-[7rem] font-mono" dir="ltr" aria-label="SKU" value={row.sku}
                    onChange={event => update(row.key, { sku: event.target.value })} />
                </td>
                <td className="min-w-[8rem]">
                  {locked ? (
                    <span className="text-gray-700" title="تُعدّل التكلفة من المشتريات">{row.cost === '' ? '—' : Number(row.cost).toFixed(2)}</span>
                  ) : (
                    <>
                      <input className="input-sm w-24" type="number" min="0" step="0.01" aria-label="سعر التكلفة" value={row.cost}
                        onChange={event => update(row.key, {
                          cost: event.target.value,
                          ...(Number(event.target.value) !== 0 ? { zeroCostConfirmed: false } : {}),
                        })} />
                      {row.cost.trim() !== '' && Number(row.cost) === 0 && (
                        <label className="mt-1 flex items-center gap-1 text-[11px] text-amber-800">
                          <input type="checkbox" checked={row.zeroCostConfirmed}
                            onChange={event => update(row.key, { zeroCostConfirmed: event.target.checked })} />
                          أؤكد أن التكلفة صفر فعلًا
                        </label>
                      )}
                    </>
                  )}
                </td>
                <td>
                  <BarcodeList barcodes={row.barcodes} precision={precision} onChange={barcodes => update(row.key, { barcodes })} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
