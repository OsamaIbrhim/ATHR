import { formatQuantity } from '@/lib/catalog/barcode'
import type { BarcodeKind } from '@/lib/catalog/types'

/** Read-only barcodes of a variant: code, pack multiplier when not 1, scale marker. */
export default function BarcodeChips({ barcodes }: { barcodes?: { code: string; pack_qty: number | string; kind: BarcodeKind }[] }) {
  if (!barcodes?.length) return <span className="text-gray-400">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {barcodes.map(barcode => (
        <span key={barcode.code} className="tag font-mono" dir="ltr">
          {barcode.code}
          {Number(barcode.pack_qty) !== 1 && <span className="text-gray-500">×{formatQuantity(barcode.pack_qty)}</span>}
          {barcode.kind === 'scale_plu' && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">ميزان</span>}
        </span>
      ))}
    </div>
  )
}
