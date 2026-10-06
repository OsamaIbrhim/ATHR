import { memo, useEffect, useState } from 'react'
import { addQuantity, formatQuantity, subtractQuantity } from '../../../electron/quantity'
import type { CartItem } from '../../types'
import { fromCents, lineCents, money } from '../../utils'
import './register.css'

// The typed text is held locally so "1." or "0.5" survive until the cashier commits (blur / Enter).
function QtyInput({ value, onCommit }: { value: number; onCommit: (next: number) => void }) {
  const [text, setText] = useState(formatQuantity(value))
  useEffect(() => setText(formatQuantity(value)), [value])
  const commit = () => {
    const next = Number(text.trim().replace(',', '.'))
    if (text.trim() !== '' && Number.isFinite(next)) onCommit(next)
    setText(formatQuantity(value))
  }
  return (
    <input
      value={text}
      inputMode="decimal"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

function discountLabel(item: CartItem) {
  if (!item.discount) return null
  return item.discount.type === 'percent' ? `خصم ${item.discount.value}%` : `خصم ${money(item.discount.value)} ج`
}

export const CartLine = memo(function CartLine({
  item,
  onQty,
  onDiscount,
}: {
  item: CartItem
  onQty: (variantId: string, next: number) => void
  onDiscount: (variantId: string) => void
}) {
  const unit = item.uom_name_ar ? ` ${item.uom_name_ar}` : ''
  const label = discountLabel(item)
  return (
    <article className="cart-item">
      <div className="cart-item-main">
        <b>{item.name}</b>
        <span>
          {item.sku}
          {item.label ? ` · ${item.label}` : ''}
        </span>
        <small>
          متاح {formatQuantity(item.available_qty)}
          {unit}
        </small>
        <button type="button" className={`line-discount${label ? ' applied' : ''}`} onClick={() => onDiscount(item.variant_id)}>
          {label ?? '+ خصم'}
        </button>
      </div>
      <div className="qty-control">
        <button onClick={() => onQty(item.variant_id, subtractQuantity(item.qty, 1))}>−</button>
        <QtyInput value={item.qty} onCommit={(next) => onQty(item.variant_id, next)} />
        <button onClick={() => onQty(item.variant_id, addQuantity(item.qty, 1))}>+</button>
      </div>
      <div className="line-price">
        <b>{money(fromCents(lineCents(item.unit_price, item.qty)))} ج</b>
        <span>
          {money(item.unit_price)} × {formatQuantity(item.qty)}
          {unit}
        </span>
      </div>
      <button className="remove-item" onClick={() => onQty(item.variant_id, 0)}>
        ×
      </button>
    </article>
  )
})
