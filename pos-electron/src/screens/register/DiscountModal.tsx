import { useEffect, useState } from 'react'
import { cleanDiscount, type Discount } from '../../../electron/sale-math'
import { FieldError, Modal } from '../../components/ui'
import { previewDiscount, type DiscountTarget } from '../../discount'
import type { CartItem } from '../../types'
import { money } from '../../utils'

const QUICK_PERCENTS = [5, 10, 15, 20]

/** Line or invoice discount. Blocks (not just warns) above what this cashier may give. */
export function DiscountModal({
  target,
  title,
  items,
  invoiceDiscount,
  limitPercent,
  isManager,
  onApply,
  onClose,
}: {
  target: DiscountTarget | null
  title: string
  items: CartItem[]
  invoiceDiscount: Discount | null
  limitPercent: number
  isManager: boolean
  onApply: (discount: Discount | null) => void
  onClose: () => void
}) {
  const current =
    target?.kind === 'invoice' ? invoiceDiscount : (items.find((item) => target?.kind === 'line' && item.variant_id === target.variantId)?.discount ?? null)
  const [type, setType] = useState<'percent' | 'amount'>('percent')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!target) return
    setType(current?.type ?? 'percent')
    setValue(current ? String(current.value) : '')
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const candidate = cleanDiscount(type, value)
  const preview = target && candidate ? previewDiscount(items, invoiceDiscount, target, candidate, limitPercent) : null

  return (
    <Modal open={!!target} title={title} onClose={onClose} width="520px">
      <div className="discount-form" onKeyDown={(event) => { if (event.key === 'Enter' && candidate && !preview?.error) onApply(candidate) }}>
        <div className="discount-type">
          <button type="button" className={type === 'percent' ? 'active' : ''} onClick={() => setType('percent')}>نسبة %</button>
          <button type="button" className={type === 'amount' ? 'active' : ''} onClick={() => setType('amount')}>مبلغ ثابت (ج)</button>
        </div>
        <label>{type === 'percent' ? 'نسبة الخصم' : 'مبلغ الخصم'}</label>
        <input dir="ltr" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} autoFocus placeholder={type === 'percent' ? '10' : '25'} />
        {type === 'percent' && (
          <div className="cash-presets">
            {QUICK_PERCENTS.map((percent) => (
              <button type="button" key={percent} onClick={() => setValue(String(percent))}>{percent}%</button>
            ))}
          </div>
        )}
        <p className="muted discount-limit">
          {isManager ? 'بصفتك مديرًا يمكنك منح أي خصم.' : `الحد الأقصى المسموح للكاشير: ${limitPercent}% من سعر الصنف.`}
        </p>
        {preview && !preview.error && (
          <div className="refund-total"><span>الإجمالي بعد الخصم</span><b>{money(preview.total)} ج</b></div>
        )}
        <FieldError>{preview?.error}</FieldError>
      </div>
      <div className="dialog-actions">
        {current && <button className="button secondary" onClick={() => onApply(null)}>إزالة الخصم</button>}
        <button className="button secondary" onClick={onClose}>إلغاء</button>
        <button className="button primary" disabled={!candidate || !!preview?.error} onClick={() => candidate && onApply(candidate)}>تطبيق الخصم</button>
      </div>
    </Modal>
  )
}
