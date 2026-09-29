'use client'
import { emptyBarcodeRow, type BarcodeRow } from '@/lib/catalog/form-model'
import { MAX_BARCODES_PER_VARIANT, packQtyStep } from '@/lib/catalog/barcode'
import type { BarcodeKind } from '@/lib/catalog/types'

/** Barcodes of one variant: code, pack quantity (units per scan) and kind. */
export default function BarcodeList({ barcodes, onChange, precision }: {
  barcodes: BarcodeRow[]
  onChange: (barcodes: BarcodeRow[]) => void
  /** Precision of the chosen unit; limits the pack quantity decimals. */
  precision?: number
}) {
  const update = (index: number, patch: Partial<BarcodeRow>) =>
    onChange(barcodes.map((barcode, position) => (position === index ? { ...barcode, ...patch } : barcode)))
  return (
    <div className="space-y-1.5">
      {barcodes.map((barcode, index) => (
        <div key={barcode.id ?? index} className="flex items-center gap-1.5">
          <input className="input-sm min-w-[8rem] font-mono" dir="ltr" placeholder="الباركود" aria-label="الباركود"
            value={barcode.code} onChange={event => update(index, { code: event.target.value })} />
          <div className="flex items-center gap-1 text-xs text-gray-500">
            ×
            <input className="input-sm w-20" type="number" min="0" step={packQtyStep(precision)} aria-label="كمية العبوة"
              title="عدد الوحدات التي يضيفها مسح الباركود مرة واحدة"
              value={barcode.kind === 'scale_plu' ? '1' : barcode.pack_qty}
              disabled={barcode.kind === 'scale_plu'}
              onChange={event => update(index, { pack_qty: event.target.value })} />
          </div>
          <select className="input-sm w-24" aria-label="نوع الباركود" value={barcode.kind}
            onChange={event => update(index, { kind: event.target.value as BarcodeKind, pack_qty: '1' })}>
            <option value="standard">عادي</option>
            <option value="scale_plu">ميزان</option>
          </select>
          <button type="button" className="px-1 text-gray-400 hover:text-red-600" aria-label="حذف الباركود"
            onClick={() => onChange(barcodes.filter((_, position) => position !== index))}>×</button>
        </div>
      ))}
      {barcodes.length < MAX_BARCODES_PER_VARIANT && (
        <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => onChange([...barcodes, emptyBarcodeRow()])}>
          + باركود
        </button>
      )}
    </div>
  )
}
