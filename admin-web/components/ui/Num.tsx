import { formatMoney, formatQty } from '@/lib/format'

/** A number, quantity or amount: always LTR, tabular, Western digits, real minus sign. */
export default function Num({ value, kind = 'plain', precision, signed, unit, tone = 'none', className = '' }: {
  value: number | string | null | undefined
  kind?: 'qty' | 'money' | 'plain'
  precision?: number
  signed?: boolean
  unit?: string
  tone?: 'auto' | 'none'
  className?: string
}) {
  const number = value === null || value === undefined || value === '' ? null : Number(value)
  const text = kind === 'money'
    ? formatMoney(value, { signed })
    : formatQty(value, { precision, signed, unit })
  const color = tone === 'auto' && number !== null && number < 0 ? 'text-red-700' : ''
  return <bdi dir="ltr" className={`inline-block tabular-nums ${color} ${className}`}>{text}</bdi>
}
